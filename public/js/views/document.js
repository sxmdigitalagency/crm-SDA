import { api } from '../api.js';
import { date, money, moneyInput, parseMoney, parseQty, qty, SYMBOL, today } from '../format.js';
import { busy, confirmDialog, errorState, html, ico, invoiceStatus, mount, quoteStatus, toast, toastError } from '../ui.js';

const UNITS = ['forfait', 'heure', 'jour', 'mois', 'unité'];
const METHODS = [['virement', 'Virement'], ['carte', 'Carte'], ['cheque', 'Chèque'], ['especes', 'Espèces'], ['autre', 'Autre']];
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function render(root, { match, query, navigate }) {
  const kind = match[1] === 'devis' ? 'quote' : 'invoice';
  const isQuote = kind === 'quote';
  const id = match[2] === 'new' ? null : Number(match[2]);
  const base = isQuote ? '/devis' : '/factures';
  const endpoint = isQuote ? '/quotes' : '/invoices';

  let doc, clients, services, settings;
  try {
    [clients, services, settings, doc] = await Promise.all([
      api.get('/clients'), api.get('/services'), api.get('/settings'),
      id ? api.get(`${endpoint}/${id}`) : Promise.resolve(null),
    ]);
  } catch (err) { mount(root, errorState(err)); return; }

  const presetClient = Number(query.get('client')) || null;
  const clientDefaults = (cid) => {
    const c = clients.find((x) => x.id === Number(cid));
    return { currency: c?.currency ?? settings.default_currency, tax_rate: c?.tax_rate ?? settings.tax_rate };
  };
  const d = doc ?? {
    client_id: presetClient ?? '', title: '', notes: '', discount: 0, status: 'draft', ...clientDefaults(presetClient),
    issue_date: today(), valid_until: addDays(today(), settings.quote_validity_days), lines: [],
    amount_paid: 0, payments: [],
  };
  if (isQuote) d.expired = d.status === 'sent' && d.valid_until < today();
  const lines = (d.lines ?? []).map((l) => ({ ...l }));
  if (!lines.length) lines.push(blankLine());
  const editable = isQuote ? d.status !== 'converted' : d.status === 'draft';
  const m = (cents) => money(cents, d.currency);
  // Devise et taux suivent le client choisi tant que l'utilisateur ne les a pas modifiés à la main.
  const touched = { currency: Boolean(doc), tax_rate: Boolean(doc) };
  let dirty = false;

  function blankLine() { return { service_id: null, description: '', details: '', quantity: 1, unit: 'forfait', unit_price: 0 }; }
  const lineAmount = (l) => Math.round(parseQty(l.quantity) * l.unit_price);
  function totals() {
    const gross = lines.reduce((s, l) => s + lineAmount(l), 0);
    const discount = Math.min(gross, d.discount || 0);
    const subtotal = gross - discount;
    const tax = Math.round((subtotal * d.tax_rate) / 100);
    return { gross, discount, subtotal, tax, total: subtotal + tax };
  }

  const title = id ? (isQuote ? `Devis ${d.number}` : d.number ? `Facture ${d.number}` : 'Facture brouillon') : isQuote ? 'Nouveau devis' : 'Nouvelle facture';
  // Le client du document reste listé même s'il a été archivé/anonymisé depuis.
  const activeClients = clients.filter((c) => !c.anonymized_at || c.id === Number(d.client_id));
  if (d.client_id && !activeClients.some((c) => c.id === Number(d.client_id))) activeClients.unshift({ id: Number(d.client_id), label: d.client_label });
  const byCategory = services.reduce((acc, s) => ((acc[s.category] ??= []).push(s), acc), {});

  const lineRow = (l, i) => html`
    <div class="line" data-i="${i}">
      <div class="line-main">
        <input class="input line-desc" data-f="description" value="${l.description}" placeholder="Désignation…" aria-label="Désignation ligne ${i + 1}" ${editable ? '' : 'readonly'}>
        ${editable ? html`<textarea class="input line-details" data-f="details" rows="1" placeholder="Détail (facultatif)…" aria-label="Détail ligne ${i + 1}">${l.details}</textarea>`
          : l.details ? html`<p class="line-details-ro">${l.details}</p>` : ''}
      </div>
      <input class="input right line-qty" data-f="quantity" inputmode="decimal" value="${qty(l.quantity)}" aria-label="Quantité" ${editable ? '' : 'readonly'}>
      <select class="input line-unit" data-f="unit" aria-label="Unité" ${editable ? '' : 'disabled'}>${UNITS.map((u) => html`<option ${u === l.unit ? 'selected' : ''}>${u}</option>`)}</select>
      <input class="input right line-price" data-f="unit_price" inputmode="decimal" value="${moneyInput(l.unit_price)}" aria-label="Prix unitaire HT en ${SYMBOL[d.currency]}" ${editable ? '' : 'readonly'}>
      <span class="line-amount num" data-amount>${m(lineAmount(l))}</span>
      ${editable ? html`<button type="button" class="btn ghost sm icon-only" data-remove aria-label="Supprimer la ligne ${i + 1}">${ico('x', { size: 16 })}</button>` : html`<span></span>`}
    </div>`;

  const statusBadge = () => (isQuote ? quoteStatus(d) : invoiceStatus(d));

  function actionsFor() {
    if (!id) return html`<button class="btn primary wide" data-save>${ico('check')}Créer ${isQuote ? 'le devis' : 'le brouillon'}</button>`;
    const pdf = html`<div class="btn-row">
      <button class="btn" data-pdf="view">${ico('eye')}Aperçu PDF</button>
      <button class="btn icon-only" data-pdf="download" aria-label="Télécharger le PDF" title="Télécharger le PDF">${ico('download')}</button>
      <button class="btn icon-only" data-mail aria-label="Préparer un email">${ico('mail')}</button></div>`;
    if (isQuote) {
      const byStatus = {
        draft: html`<button class="btn wide" data-status="sent">${ico('send')}Marquer comme envoyé</button>`,
        sent: html`<div class="btn-row"><button class="btn wide" data-status="accepted">${ico('check')}Accepté</button><button class="btn wide" data-status="declined">${ico('x')}Refusé</button></div>`,
        accepted: html`<button class="btn primary wide" data-convert>${ico('repeat')}Convertir en facture</button>`,
        declined: html`<button class="btn wide" data-status="sent">${ico('arrow-left')}Rouvrir le devis</button>`,
        converted: html`<a class="btn primary wide" href="/factures/${d.invoice_id}" data-link>${ico('receipt')}Voir la facture</a>`,
      };
      return html`${editable ? html`<button class="btn primary wide" data-save>${ico('check')}Enregistrer</button>` : ''}${byStatus[d.status]}${pdf}`;
    }
    if (d.status === 'draft') return html`<button class="btn wide" data-save>${ico('check')}Enregistrer</button>
      <button class="btn primary wide" data-issue>${ico('file-check')}Émettre la facture</button>${pdf}`;
    return pdf;
  }

  mount(root, html`
    <a class="back" href="${base}" data-link>${ico('arrow-left', { size: 14 })}${isQuote ? 'Devis' : 'Factures'}</a>
    <header class="page-head">
      <div><h1 class="title-with-badge">${title}${id ? statusBadge() : ''}</h1>
        <p>${d.client_label ?? ''}${id && d.issue_date ? ` · ${isQuote ? 'émis' : 'émise'} le ${date(d.issue_date)}` : ''}${d.quote_number ? ` · depuis le devis ${d.quote_number}` : ''}</p></div>
    </header>

    <div class="split editor ${editable ? '' : 'is-readonly'}">
      <form class="stack" novalidate id="doc-form">
        <section class="panel glass-panel">
          <div class="form-grid">
            <label class="field span-2"><span>Client</span>
              <select class="input" name="client_id" required ${editable ? '' : 'disabled'} data-ro="${!editable}">
                <option value="">Choisir un client…</option>
                ${activeClients.map((c) => html`<option value="${c.id}" ${Number(d.client_id) === c.id ? 'selected' : ''}>${c.label}</option>`)}
              </select>
              ${activeClients.length ? '' : html`<small>Aucun client : <a href="/clients/new" data-link>créez-en un d'abord</a>.</small>`}
            </label>
            <label class="field span-2"><span>Objet</span><input class="input" name="title" value="${d.title}" placeholder="${isQuote ? 'Ex. Refonte du site vitrine…' : 'Ex. Développement du site vitrine…'}" ${editable ? '' : 'readonly'}></label>
            ${editable ? html`
              <label class="field"><span>Devise</span><select class="input" name="currency">
                ${['EUR', 'USD'].map((c) => html`<option value="${c}" ${d.currency === c ? 'selected' : ''}>${c === 'EUR' ? 'Euro (€)' : 'Dollar US ($US)'}</option>`)}
              </select></label>
              <label class="field"><span>${settings.tax_label} (%)</span><input class="input right" name="tax_rate" inputmode="decimal" value="${qty(d.tax_rate)}" autocomplete="off"></label>`
            : html`<label class="field"><span>Devise</span><input class="input" value="${d.currency === 'EUR' ? 'Euro (€)' : 'Dollar US ($US)'}" readonly></label>
              <label class="field"><span>${settings.tax_label}</span><input class="input" value="${qty(d.tax_rate)} %" readonly></label>`}
            ${isQuote ? html`
              <label class="field"><span>Date du devis</span><input class="input" type="date" name="issue_date" value="${d.issue_date}" ${editable ? '' : 'readonly'}></label>
              <label class="field"><span>Valable jusqu'au</span><input class="input" type="date" name="valid_until" value="${d.valid_until}" ${editable ? '' : 'readonly'}></label>`
            : d.status === 'draft' ? html`<p class="hint span-2">${ico('clock', { size: 15 })}Le numéro et la date de facture sont attribués à l'émission, pour garantir une numérotation continue.</p>`
            : html`<label class="field"><span>Émise le</span><input class="input" value="${date(d.issue_date)}" readonly></label>
                   <label class="field"><span>Échéance</span><input class="input" value="${date(d.due_date)}" readonly></label>`}
          </div>
        </section>

        <section class="panel glass-panel">
          <div class="panel-head"><h2>Prestations</h2>${editable ? '' : html`<span class="muted">${isQuote ? 'Devis facturé' : 'Facture émise'} : contenu figé</span>`}</div>
          <div class="lines-head" aria-hidden="true"><span>Désignation</span><span class="r">Qté</span><span>Unité</span><span class="r">PU HT</span><span class="r">Montant HT</span><span></span></div>
          <div class="lines" id="lines">${lines.map(lineRow)}</div>
          ${editable ? html`<div class="lines-add">
            <button type="button" class="btn sm" data-add>${ico('plus', { size: 15 })}Ligne libre</button>
            ${services.length ? html`<label class="catalog-pick">${ico('package', { size: 15 })}<span class="visually-hidden">Ajouter depuis le catalogue</span>
              <select class="input" data-catalog><option value="">Ajouter depuis le catalogue…</option>
                ${Object.entries(byCategory).map(([cat, list]) => html`<optgroup label="${cat}">${list.map((s) => html`<option value="${s.id}">${s.name} — ${moneyInput(s.unit_price)} / ${s.unit}</option>`)}</optgroup>`)}
              </select></label>` : html`<a class="muted small-link" href="/prestations" data-link>Créer un catalogue de prestations</a>`}
          </div>` : ''}
        </section>

        <section class="panel glass-panel">
          <label class="field"><span>Notes affichées sur le document</span>
            ${editable ? html`<textarea class="input" name="notes" rows="3" placeholder="${isQuote ? 'Planning, livrables, modalités…' : 'Référence de commande, précisions…'}">${d.notes}</textarea>`
              : html`<p class="readonly-text">${d.notes || '—'}</p><input type="hidden" name="notes" value="${d.notes}">`}</label>
        </section>
      </form>

      <aside class="sticky-side">
        <section class="panel glass-float totals-card">
          <dl class="totals" id="totals"></dl>
          <div class="actions" id="actions">${actionsFor()}</div>
          <p class="form-error" role="alert" id="err"></p>
        </section>
        ${!isQuote && id && d.status !== 'draft' ? html`<section class="panel glass-panel" id="payments"></section>` : ''}
        ${id && ((isQuote && d.status !== 'converted') || (!isQuote && (d.status === 'draft' || (d.status === 'issued' && !d.amount_paid)))) ? html`
          <section class="panel glass-panel danger-zone">
            ${!isQuote && d.status === 'issued'
              ? html`<h2>Annuler la facture</h2><p class="muted">Le numéro reste consommé ; la facture apparaîtra comme annulée.</p><button class="btn danger sm" data-cancel>${ico('ban', { size: 15 })}Annuler la facture</button>`
              : html`<h2>Supprimer ${isQuote ? 'le devis' : 'le brouillon'}</h2><p class="muted">Action définitive.</p><button class="btn danger sm" data-delete>${ico('trash-2', { size: 15 })}Supprimer</button>`}
          </section>` : ''}
      </aside>
    </div>
  `);

  const form = root.querySelector('#doc-form');
  const linesEl = root.querySelector('#lines');
  const totalsEl = root.querySelector('#totals');
  const err = root.querySelector('#err');

  function paintTotals() {
    const t = totals();
    const discountField = editable
      ? html`<input class="input right discount" id="discount" inputmode="decimal" value="${moneyInput(d.discount || 0)}" aria-label="Remise HT">`
      : html`<span class="num">- ${m(t.discount)}</span>`;
    mount(totalsEl, html`
      <div><dt>Total HT brut</dt><dd class="num">${m(t.gross)}</dd></div>
      ${editable || t.discount ? html`<div class="discount-row"><dt>Remise HT</dt><dd>${discountField}</dd></div>` : ''}
      <div><dt>Total HT</dt><dd class="num">${m(t.subtotal)}</dd></div>
      <div><dt>${settings.tax_label} ${qty(d.tax_rate)} %</dt><dd class="num">${m(t.tax)}</dd></div>
      <div class="grand"><dt>${d.tax_rate ? 'Total TTC' : 'Total'}</dt><dd class="num">${m(t.total)}</dd></div>
      ${!isQuote && d.status !== 'draft' ? html`<div><dt>Déjà réglé</dt><dd class="num">${m(d.amount_paid)}</dd></div>
        <div class="grand due"><dt>Reste à payer</dt><dd class="num">${m(d.total - d.amount_paid)}</dd></div>` : ''}
    `);
    totalsEl.querySelector('#discount')?.addEventListener('change', (e) => { d.discount = Math.max(0, parseMoney(e.target.value)); markDirty(); paintTotals(); });
  }

  function markDirty() {
    dirty = true;
    const save = root.querySelector('[data-save]');
    if (save) save.disabled = false;
  }
  function repaintLines() { mount(linesEl, html`${lines.map(lineRow)}`); autoGrow(); }
  function autoGrow() { linesEl.querySelectorAll('.line-details').forEach((t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }); }

  if (editable) {
    linesEl.addEventListener('input', (e) => {
      const row = e.target.closest('.line');
      if (!row) return;
      const l = lines[Number(row.dataset.i)];
      const f = e.target.dataset.f;
      if (f === 'quantity') l.quantity = parseQty(e.target.value);
      else if (f === 'unit_price') l.unit_price = parseMoney(e.target.value);
      else l[f] = e.target.value;
      if (f === 'details') autoGrow();
      row.querySelector('[data-amount]').textContent = m(lineAmount(l));
      markDirty();
      paintTotals();
    });
    linesEl.addEventListener('change', (e) => {
      // Reformate proprement à la sortie du champ (« 1800 » → « 1800,00 »).
      if (e.target.dataset.f === 'unit_price') e.target.value = moneyInput(parseMoney(e.target.value));
      if (e.target.dataset.f === 'quantity') e.target.value = qty(parseQty(e.target.value));
    });
    linesEl.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (!rm) return;
      lines.splice(Number(rm.closest('.line').dataset.i), 1);
      if (!lines.length) lines.push(blankLine());
      repaintLines(); markDirty(); paintTotals();
    });
    root.querySelector('[data-add]').addEventListener('click', () => {
      lines.push(blankLine()); repaintLines(); markDirty();
      linesEl.querySelector('.line:last-child .line-desc').focus();
    });
    root.querySelector('[data-catalog]')?.addEventListener('change', (e) => {
      const s = services.find((x) => x.id === Number(e.target.value));
      e.target.value = '';
      if (!s) return;
      const empty = lines.length === 1 && !lines[0].description && !lines[0].unit_price;
      const line = { service_id: s.id, description: s.name, details: s.description, quantity: 1, unit: s.unit, unit_price: s.unit_price };
      if (empty) lines[0] = line; else lines.push(line);
      repaintLines(); markDirty(); paintTotals();
    });
    form.addEventListener('input', (e) => { if (!e.target.closest('#lines')) markDirty(); });
    const applyMoneyFields = () => {
      linesEl.querySelectorAll('.line').forEach((row) => { row.querySelector('[data-amount]').textContent = m(lineAmount(lines[Number(row.dataset.i)])); });
      paintTotals();
    };
    form.currency.addEventListener('change', (e) => { touched.currency = true; d.currency = e.target.value; applyMoneyFields(); });
    form.tax_rate.addEventListener('change', (e) => {
      touched.tax_rate = true;
      const v = parseQty(e.target.value);
      d.tax_rate = v >= 0 && v <= 100 ? v : d.tax_rate;
      e.target.value = qty(d.tax_rate);
      paintTotals();
    });
    form.client_id.addEventListener('change', (e) => {
      const def = clientDefaults(e.target.value);
      if (!touched.currency) { d.currency = def.currency; form.currency.value = def.currency; }
      if (!touched.tax_rate) { d.tax_rate = def.tax_rate; form.tax_rate.value = qty(def.tax_rate); }
      applyMoneyFields();
    });
  }

  const payload = () => {
    const fd = new FormData(form);
    return {
      client_id: Number(fd.get('client_id')), title: fd.get('title'), notes: fd.get('notes'),
      issue_date: fd.get('issue_date') || undefined, valid_until: fd.get('valid_until') || undefined,
      discount: d.discount || 0,
      currency: d.currency, tax_rate: d.tax_rate,
      lines: lines.filter((l) => l.description.trim()).map((l) => ({ ...l, quantity: parseQty(l.quantity) })),
    };
  };

  async function save() {
    err.textContent = '';
    const p = payload();
    if (!p.client_id) { err.textContent = 'Choisissez un client.'; form.client_id.focus(); return null; }
    if (!p.lines.length) { err.textContent = 'Ajoutez au moins une ligne avec une désignation.'; linesEl.querySelector('.line-desc')?.focus(); return null; }
    try {
      const res = id ? await api.put(`${endpoint}/${id}`, p) : await api.post(endpoint, p);
      dirty = false;
      return res;
    } catch (e) { err.textContent = e.message; toastError(e); return null; }
  }

  root.querySelector('#actions').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-save]')) {
      await busy(b, async () => {
        const res = await save();
        if (!res) return;
        toast(id ? 'Modifications enregistrées' : isQuote ? `Devis ${res.number} créé` : 'Brouillon de facture créé');
        navigate(`${base}/${res.id ?? id}`, { replace: true });
      });
    } else if (b.matches('[data-status]')) {
      await busy(b, async () => {
        if (dirty && !(await save())) return;
        try { await api.put(`/quotes/${id}`, { status: b.dataset.status }); toast('Statut mis à jour'); navigate(`${base}/${id}`, { replace: true }); }
        catch (e2) { toastError(e2); }
      });
    } else if (b.matches('[data-convert]')) {
      await busy(b, async () => {
        if (dirty && !(await save())) return;
        try { const r = await api.post(`/quotes/${id}/convert`); toast('Facture brouillon créée'); navigate(`/factures/${r.invoice_id}`); }
        catch (e2) { toastError(e2); }
      });
    } else if (b.matches('[data-issue]')) {
      if (dirty && !(await save())) return;
      const ok = await confirmDialog({
        title: 'Émettre la facture ?',
        body: `Un numéro définitif (${settings.invoice_prefix}-${new Date().getFullYear()}-…) sera attribué et le contenu ne pourra plus être modifié. Échéance : ${settings.payment_terms_days} jours.`,
        confirm: 'Émettre',
      });
      if (!ok) return;
      await busy(b, async () => {
        try { const r = await api.put(`/invoices/${id}`, { action: 'issue' }); toast(`Facture ${r.number} émise`); navigate(`${base}/${id}`, { replace: true }); }
        catch (e2) { toastError(e2); }
      });
    } else if (b.matches('[data-pdf]')) {
      // L'onglet est ouvert tout de suite (dans le geste de l'utilisateur) pour ne pas être bloqué comme pop-up.
      const tab = b.dataset.pdf === 'view' ? window.open('', '_blank') : null;
      if (tab) tab.document.title = 'Génération du PDF…';
      await busy(b, async () => {
        try {
          if (dirty && !(await save())) { tab?.close(); return; }
          const { generatePdf } = await import('/js/vendor/pdf.js');
          const { blob, filename } = await generatePdf(kind, id);
          const url = URL.createObjectURL(blob);
          if (tab) tab.location.href = url;
          else {
            const a = document.createElement('a');
            a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
          }
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (e2) { tab?.close(); toastError(e2); }
      });
    } else if (b.matches('[data-mail]')) {
      const client = clients.find((c) => c.id === Number(d.client_id));
      const subject = `${isQuote ? 'Devis' : 'Facture'} ${d.number ?? ''} — ${settings.company_name}`;
      const body = `Bonjour,\n\nVous trouverez ci-joint ${isQuote ? 'notre devis' : 'notre facture'} ${d.number ?? ''} d'un montant de ${m(d.total)}${d.title ? ` (${d.title})` : ''}.\n\nBien cordialement,\n${settings.company_name}`;
      location.href = `mailto:${client?.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      toast('Pensez à joindre le PDF téléchargé à votre email.');
    }
  });

  root.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: isQuote ? `Supprimer le devis ${d.number} ?` : 'Supprimer ce brouillon ?', body: 'Cette action est définitive.', confirm: 'Supprimer', danger: true });
    if (!ok) return;
    try { await api.del(`${endpoint}/${id}`); toast('Supprimé'); dirty = false; navigate(base, { replace: true }); } catch (e) { toastError(e); }
  });
  root.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `Annuler la facture ${d.number} ?`, body: 'Le numéro reste consommé. Pour une facture déjà envoyée au client, émettez aussi un avoir si nécessaire.', confirm: 'Annuler la facture', danger: true });
    if (!ok) return;
    try { await api.put(`/invoices/${id}`, { action: 'cancel' }); toast('Facture annulée'); navigate(`${base}/${id}`, { replace: true }); } catch (e) { toastError(e); }
  });

  // ── Paiements (facture émise) ────────────────────────────
  const payEl = root.querySelector('#payments');
  if (payEl) {
    const remaining = d.total - d.amount_paid;
    mount(payEl, html`
      <div class="panel-head"><h2>Paiements</h2><span class="muted">${d.payments.length}</span></div>
      ${d.payments.length ? html`<ul class="payments">${d.payments.map((p) => html`
        <li><span class="feed-icon payment">${ico('banknote', { size: 15 })}</span>
          <span><strong class="num">${m(p.amount)}</strong><small>${date(p.paid_at)} · ${METHODS.find((m) => m[0] === p.method)?.[1] ?? p.method}${p.reference ? ` · ${p.reference}` : ''}</small></span>
          ${d.status !== 'cancelled' ? html`<button class="btn ghost sm icon-only" data-del-pay="${p.id}" aria-label="Supprimer ce paiement">${ico('trash-2', { size: 15 })}</button>` : ''}</li>`)}</ul>`
        : html`<p class="muted quiet">Aucun paiement enregistré.</p>`}
      ${d.status === 'issued' ? html`
        <form class="pay-form" novalidate>
          <div class="form-grid">
            <label class="field"><span>Montant</span><input class="input right" name="amount" inputmode="decimal" value="${moneyInput(remaining)}"></label>
            <label class="field"><span>Date</span><input class="input" type="date" name="paid_at" value="${today()}"></label>
            <label class="field"><span>Moyen</span><select class="input" name="method">${METHODS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label>
            <label class="field"><span>Référence</span><input class="input" name="reference" placeholder="Facultatif…"></label>
          </div>
          <button class="btn primary wide" type="submit">${ico('plus')}Enregistrer le paiement</button>
        </form>` : ''}
    `);
    payEl.querySelector('.pay-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      busy(e.target.querySelector('[type=submit]'), async () => {
        try {
          await api.post(`/invoices/${id}/payments`, { ...fd, amount: parseMoney(fd.amount) });
          toast(parseMoney(fd.amount) >= remaining ? 'Facture soldée' : 'Paiement enregistré');
          navigate(`${base}/${id}`, { replace: true });
        } catch (e2) { toastError(e2); }
      });
    });
    payEl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del-pay]');
      if (!b) return;
      if (!(await confirmDialog({ title: 'Supprimer ce paiement ?', body: 'Le reste à payer sera recalculé.', confirm: 'Supprimer', danger: true }))) return;
      try { await api.del(`/invoices/${id}/payments?payment=${b.dataset.delPay}`); toast('Paiement supprimé'); navigate(`${base}/${id}`, { replace: true }); }
      catch (e2) { toastError(e2); }
    });
  }

  paintTotals();
  autoGrow();
  const guard = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  return () => window.removeEventListener('beforeunload', guard);
}

