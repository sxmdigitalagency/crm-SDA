import { api } from '../api.js';
import { CURRENCIES, date, money0, moneyInput, parseMoney, today } from '../format.js';
import { busy, clientName, confirmDialog, errorState, html, ico, mount, quoteStatus, toast, toastError } from '../ui.js';

export const STAGES = [
  { key: 'lead', label: 'Nouveau contact', hint: 'Une demande, une recommandation, un premier échange.' },
  { key: 'qualified', label: 'Besoin qualifié', hint: 'Besoin, budget et délai compris.' },
  { key: 'proposal', label: 'Devis envoyé', hint: 'La proposition est entre ses mains.' },
  { key: 'negotiation', label: 'Négociation', hint: 'Ajustements, relances, dernières questions.' },
  { key: 'won', label: 'Gagnée', hint: 'Accord obtenu.' },
  { key: 'lost', label: 'Perdue', hint: 'Pas cette fois : notez pourquoi.' },
];
const OPEN = ['lead', 'qualified', 'proposal', 'negotiation'];
const stageLabel = (k) => STAGES.find((s) => s.key === k)?.label ?? k;

/** Totaux par devise, jamais additionnés entre devises. */
function totals(deals) {
  const by = {};
  for (const d of deals) by[d.currency] = (by[d.currency] ?? 0) + d.amount;
  const parts = CURRENCIES.filter((c) => by[c]).map((c) => money0(by[c], c));
  return parts.length ? parts.join(' · ') : '—';
}

export async function render(root, { navigate, query }) {
  let deals, clients;
  try { [deals, clients] = await Promise.all([api.get('/deals'), api.get('/clients')]); }
  catch (err) { mount(root, errorState(err)); return; }
  const usable = clients; // l'API ne renvoie pas les clients anonymisés

  function card(d) {
    const late = OPEN.includes(d.stage) && d.expected_close_date && d.expected_close_date < today();
    return html`
      <li class="deal-card glass-solid" draggable="true" data-deal="${d.id}" tabindex="0" aria-label="${d.title}, ${d.client_label}">
        <span class="deal-title">${d.title}</span>
        <span class="deal-client">${d.client_label}</span>
        <span class="deal-meta">
          <strong class="num">${d.amount ? money0(d.amount, d.currency) : '—'}</strong>
          ${d.expected_close_date ? html`<span class="${late ? 'late' : ''}">${ico('calendar', { size: 13 })}${date(d.expected_close_date)}</span>` : ''}
        </span>
        ${d.quote_number ? html`<span class="deal-quote">${ico('file-text', { size: 13 })}${d.quote_number} ${quoteStatus({ status: d.quote_status })}</span>` : ''}
        ${d.stage === 'lost' && d.lost_reason ? html`<span class="deal-reason">${d.lost_reason}</span>` : ''}
      </li>`;
  }

  function paint() {
    const open = deals.filter((d) => OPEN.includes(d.stage));
    const monthStart = today().slice(0, 7);
    const wonMonth = deals.filter((d) => d.stage === 'won' && (d.closed_at ?? '').slice(0, 7) === monthStart);
    mount(root, html`
      <header class="page-head">
        <div><h1>Pipeline</h1><p>Vos affaires en cours, de la première prise de contact à la signature. <span class="hide-sm">Glissez une carte pour la faire avancer.</span><span class="mobile-only">Touchez une carte pour changer son étape.</span></p></div>
        <div class="page-actions"><button class="btn primary" data-new>${ico('plus')}Nouvelle affaire</button></div>
      </header>
      <section class="pipe-summary glass-panel" aria-label="Résumé">
        <div><span class="pulse-label">En cours</span><strong class="num">${totals(open)}</strong><small>${open.length} affaire${open.length > 1 ? 's' : ''}</small></div>
        <div><span class="pulse-label">Gagnées ce mois-ci</span><strong class="num">${totals(wonMonth)}</strong><small>${wonMonth.length} affaire${wonMonth.length > 1 ? 's' : ''}</small></div>
        <div><span class="pulse-label">À relancer</span><strong class="num">${open.filter((d) => d.expected_close_date && d.expected_close_date < today()).length}</strong><small>date de signature dépassée</small></div>
      </section>
      ${deals.length ? '' : html`<section class="panel glass-panel"><div class="empty">${ico('kanban', { size: 28 })}<h3>Aucune affaire pour l'instant</h3>
        <p>Créez une affaire dès le premier échange avec un prospect : vous verrez d'un coup d'œil ce qui est en cours, ce qui traîne et ce qui est signé.</p>
        <button class="btn primary" data-new>${ico('plus')}Créer une affaire</button></div></section>`}
      <div class="board" role="list" ${deals.length ? '' : 'hidden'}>
        ${STAGES.map((s) => {
          const list = deals.filter((d) => d.stage === s.key);
          return html`
          <section class="column glass-panel stage-${s.key}" role="listitem" aria-label="${s.label}">
            <header class="column-head" title="${s.hint}">
              <h2>${s.label}</h2><span class="count">${list.length}</span>
              <small class="num">${list.length ? totals(list) : ''}</small>
            </header>
            <ul class="column-list" data-stage="${s.key}">${list.map(card)}</ul>
          </section>`;
        })}
      </div>`);
  }

  // ── Fiche d'une affaire (création / édition) ─────────────
  async function openDeal(id, preset = {}) {
    const d = id ? deals.find((x) => x.id === id) : {
      title: '', client_id: preset.client ?? '', stage: preset.stage ?? 'lead', amount: 0,
      currency: usable.find((c) => c.id === preset.client)?.currency ?? 'EUR', expected_close_date: '', quote_id: null, lost_reason: '', notes: '',
    };
    const quotesOf = async (cid) => (cid ? (await api.get(`/clients/${cid}`)).quotes : []);
    let quotes = [];
    try { quotes = await quotesOf(d.client_id); } catch { /* liste vide : on peut toujours enregistrer */ }

    // Client anonymisé ou absent de la liste : on le garde sélectionnable pour ne pas casser l'enregistrement.
    const choices = d.client_id && !usable.some((c) => c.id === Number(d.client_id))
      ? [{ id: Number(d.client_id), label: d.client_label }, ...usable] : usable;
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog deal-dialog glass-solid';
    const quoteOptions = () => html`<option value="">Aucun</option>${quotes.map((q) => html`<option value="${q.id}" ${q.id === d.quote_id ? 'selected' : ''}>${q.number}${q.title ? ` — ${q.title}` : ''}</option>`)}`;
    mount(dlg, html`
      <form method="dialog" novalidate>
        <div class="dialog-body">
          <h2>${id ? 'Affaire' : 'Nouvelle affaire'}</h2>
          <div class="form-grid">
            <label class="field span-2"><span>Intitulé</span><input class="input" name="title" value="${d.title}" required placeholder="Ex. Refonte du site, automatisation des devis…"></label>
            <label class="field span-2"><span>Client</span>
              <select class="input" name="client_id" required>
                <option value="">Choisir un client…</option>
                ${choices.map((c) => html`<option value="${c.id}" ${c.id === Number(d.client_id) ? 'selected' : ''}>${c.label ?? clientName(c)}</option>`)}
              </select>
              <small>Un prospect est un client au statut « Prospect » : <a href="/clients/new" data-link>créer une fiche</a>.</small></label>
            <label class="field"><span>Montant estimé HT</span><input class="input right" name="amount" inputmode="decimal" value="${moneyInput(d.amount)}"></label>
            <label class="field"><span>Devise</span><select class="input" name="currency">${CURRENCIES.map((c) => html`<option ${c === d.currency ? 'selected' : ''}>${c}</option>`)}</select></label>
            <label class="field"><span>Étape</span><select class="input" name="stage">${STAGES.map((s) => html`<option value="${s.key}" ${s.key === d.stage ? 'selected' : ''}>${s.label}</option>`)}</select></label>
            <label class="field"><span>Signature prévue</span><input class="input" type="date" name="expected_close_date" value="${d.expected_close_date ?? ''}"></label>
            <label class="field span-2" data-lost ${d.stage === 'lost' ? '' : 'hidden'}><span>Raison de la perte</span><input class="input" name="lost_reason" value="${d.lost_reason}" placeholder="Prix, délai, concurrent, projet abandonné…"></label>
            <label class="field span-2"><span>Devis lié</span><select class="input" name="quote_id">${quoteOptions()}</select></label>
            <label class="field span-2"><span>Notes</span><textarea class="input" name="notes" rows="3" placeholder="Contexte, prochaine action, interlocuteur…">${d.notes}</textarea></label>
          </div>
          <p class="form-error" role="alert"></p>
        </div>
        <div class="dialog-actions">
          ${id ? html`<button type="button" class="btn danger icon-only" data-del title="Supprimer l’affaire" aria-label="Supprimer l’affaire">${ico('trash-2')}</button>` : ''}
          ${id && !d.quote_id ? html`<button type="button" class="btn" data-quote>${ico('file-text')}Créer le devis</button>` : ''}
          ${id && d.quote_id ? html`<a class="btn" href="/devis/${d.quote_id}" data-link>${ico('file-text')}Ouvrir le devis</a>` : ''}
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-close>Annuler</button>
          <button class="btn primary" type="submit" value="save">${ico('check')}${id ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>`);
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    const err = dlg.querySelector('.form-error');
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    (id || preset.client ? form.elements.title : form.client_id).focus();

    form.stage.addEventListener('change', () => { dlg.querySelector('[data-lost]').hidden = form.stage.value !== 'lost'; });
    form.client_id.addEventListener('change', async () => {
      const c = usable.find((x) => x.id === Number(form.client_id.value));
      if (c?.currency && !id) form.currency.value = c.currency;
      try { quotes = await quotesOf(Number(form.client_id.value)); } catch { quotes = []; }
      d.quote_id = null;
      mount(form.quote_id, quoteOptions());
    });
    dlg.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) dlg.close();
      else if (e.target.closest('a[data-link]')) dlg.close();
      else if (e.target.closest('[data-quote]')) {
        dlg.close();
        navigate(`/devis/new?client=${d.client_id}&deal=${id}&title=${encodeURIComponent(d.title)}`);
      } else if (e.target.closest('[data-del]')) {
        dlg.close();
        if (!(await confirmDialog({ title: `Supprimer « ${d.title} » ?`, body: 'L’affaire disparaît du pipeline. Le client et ses devis ne sont pas touchés.', confirm: 'Supprimer', danger: true }))) return;
        try { await api.del(`/deals/${id}`); deals = deals.filter((x) => x.id !== id); toast('Affaire supprimée'); paint(); } catch (e2) { toastError(e2); }
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      err.textContent = '';
      if (!fd.title.trim()) { err.textContent = 'Donnez un intitulé à l’affaire.'; form.elements.title.focus(); return; }
      if (!fd.client_id) { err.textContent = 'Choisissez un client.'; form.client_id.focus(); return; }
      const body = { ...fd, client_id: Number(fd.client_id), amount: parseMoney(fd.amount), quote_id: fd.quote_id ? Number(fd.quote_id) : null };
      busy(form.querySelector('[type=submit]'), async () => {
        try {
          if (id) await api.put(`/deals/${id}`, body); else await api.post('/deals', body);
          deals = await api.get('/deals');
          dlg.close();
          toast(id ? 'Affaire mise à jour' : 'Affaire créée');
          paint();
        } catch (e2) { err.textContent = e2.message; }
      });
    });
  }

  // ── Glisser-déposer (souris) ; au clavier et au doigt : la fiche, champ « Étape » ──
  let dragged = null;
  root.addEventListener('dragstart', (e) => {
    const li = e.target.closest('[data-deal]');
    if (!li) return;
    dragged = li;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.deal);
  });
  root.addEventListener('dragend', () => {
    dragged?.classList.remove('dragging');
    root.querySelectorAll('.column-list.over').forEach((l) => l.classList.remove('over'));
    dragged = null;
  });
  root.addEventListener('dragover', (e) => {
    const list = e.target.closest('.column-list');
    if (!list || !dragged) return;
    e.preventDefault();
    root.querySelectorAll('.column-list.over').forEach((l) => l !== list && l.classList.remove('over'));
    list.classList.add('over');
    const after = [...list.querySelectorAll('[data-deal]:not(.dragging)')].find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) list.insertBefore(dragged, after); else list.append(dragged);
  });
  root.addEventListener('drop', async (e) => {
    const list = e.target.closest('.column-list');
    if (!list || !dragged) return;
    e.preventDefault();
    const id = Number(dragged.dataset.deal);
    const stage = list.dataset.stage;
    const order = [...list.querySelectorAll('[data-deal]')].map((el) => Number(el.dataset.deal));
    const deal = deals.find((d) => d.id === id);
    const moved = deal.stage !== stage;
    try {
      await api.post(`/deals/${id}/move`, { stage, order });
      deals = await api.get('/deals');
      if (moved) toast(`« ${deal.title} » → ${stageLabel(stage)}`);
      paint();
      if (moved && stage === 'lost') openDeal(id);
    } catch (err) { toastError(err); deals = await api.get('/deals').catch(() => deals); paint(); }
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) return openDeal(null);
    const li = e.target.closest('[data-deal]');
    if (li) openDeal(Number(li.dataset.deal));
  });
  root.addEventListener('keydown', (e) => {
    const li = e.target.closest('[data-deal]');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDeal(Number(li.dataset.deal)); }
  });

  paint();
  const preset = Number(query.get('client')) || null;
  if (query.get('new') === '1') openDeal(null, { client: preset });
  const linked = Number(query.get('deal'));
  if (linked && deals.some((d) => d.id === linked)) openDeal(linked);
}
