import { api } from '../api.js';
import { date, money, moneyByCurrency, sumByCurrency } from '../format.js';
import { bindRowLinks, clientName, clientStatus, confirmDialog, errorState, html, ico, invoiceStatus, mount, quoteStatus, toast, toastError } from '../ui.js';

export async function render(root, { match, navigate }) {
  const id = Number(match[1]);
  let c;
  try { c = await api.get(`/clients/${id}`); }
  catch (err) { mount(root, errorState(err)); return; }

  const issued = c.invoices.filter((i) => i.status === 'issued' || i.status === 'paid');
  const invoiced = sumByCurrency(issued, (i) => i.total);
  const paid = sumByCurrency(issued, (i) => i.amount_paid);
  const due = sumByCurrency(issued, (i) => i.total - i.amount_paid);
  const contact = [c.first_name, c.last_name].filter(Boolean).join(' ');
  const anonymized = Boolean(c.anonymized_at);

  mount(root, html`
    <a class="back" href="/clients" data-link>${ico('arrow-left', { size: 14 })}Clients</a>
    <header class="page-head">
      <div><h1>${clientName(c)}</h1><p>${c.type === 'pro' ? 'Professionnel' : 'Particulier'}${c.city ? ` · ${c.city}` : ''} · client depuis le ${date(c.created_at)}</p></div>
      <div class="page-actions">
        ${anonymized ? '' : html`
          <a class="btn" href="/clients/${id}/edit" data-link>${ico('pencil')}Modifier</a>
          <a class="btn" href="/factures/new?client=${id}" data-link>${ico('receipt')}Facture</a>
          <a class="btn primary" href="/devis/new?client=${id}" data-link>${ico('plus')}Nouveau devis</a>`}
      </div>
    </header>

    <div class="split">
      <div class="stack">
        <section class="pulse glass-panel pulse-3">
          <div class="pulse-item"><span class="pulse-label">Facturé</span><span class="pulse-value num">${moneyByCurrency(invoiced)}</span></div>
          <div class="pulse-item"><span class="pulse-label">Encaissé</span><span class="pulse-value num">${moneyByCurrency(paid)}</span></div>
          <div class="pulse-item"><span class="pulse-label">Reste dû</span><span class="pulse-value num">${moneyByCurrency(due)}</span></div>
        </section>

        <section class="panel flush glass-panel">
          <div class="panel-head"><h2>Devis</h2><span class="muted">${c.quotes.length}</span></div>
          ${c.quotes.length ? html`<div class="table-wrap"><table class="data" data-quotes>
            <thead><tr><th>Numéro</th><th>Objet</th><th>Date</th><th>Statut</th><th class="r">Total TTC</th></tr></thead>
            <tbody>${c.quotes.map((q) => html`<tr data-href="/devis/${q.id}"><td class="ref">${q.number}</td><td>${q.title || '—'}</td><td class="ref">${date(q.issue_date)}</td>
              <td>${quoteStatus({ ...q, expired: q.status === 'sent' && q.valid_until < new Date().toISOString().slice(0, 10) })}</td><td class="r">${money(q.total, q.currency)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted quiet" style="padding:0 var(--s-6) var(--s-5)">Aucun devis pour ce client.</p>`}
        </section>

        <section class="panel flush glass-panel">
          <div class="panel-head"><h2>Factures</h2><span class="muted">${c.invoices.length}</span></div>
          ${c.invoices.length ? html`<div class="table-wrap"><table class="data" data-invoices>
            <thead><tr><th>Numéro</th><th>Objet</th><th>Échéance</th><th>Statut</th><th class="r">Total TTC</th></tr></thead>
            <tbody>${c.invoices.map((i) => html`<tr data-href="/factures/${i.id}"><td class="ref">${i.number ?? 'Brouillon'}</td><td>${i.title || '—'}</td><td class="ref">${date(i.due_date)}</td>
              <td>${invoiceStatus({ ...i, overdue: i.status === 'issued' && i.due_date < new Date().toISOString().slice(0, 10) })}</td><td class="r">${money(i.total, i.currency)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted quiet" style="padding:0 var(--s-6) var(--s-5)">Aucune facture pour ce client.</p>`}
        </section>
      </div>

      <aside class="sticky-side">
        <section class="panel glass-panel">
          <div class="panel-head"><h2>Coordonnées</h2>${clientStatus(c)}</div>
          <dl class="facts">
            ${contact && c.company_name ? html`<dt>Contact</dt><dd>${contact}</dd>` : ''}
            <dt>Email</dt><dd>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—'}</dd>
            <dt>Facturation</dt><dd>${c.currency === 'USD' ? 'Dollars US' : 'Euros'}${c.tax_rate != null ? ` · taxe ${String(c.tax_rate).replace('.', ',')} %` : ''}</dd>
            <dt>Téléphone</dt><dd>${c.phone ? html`<a href="tel:${c.phone.replace(/\s/g, '')}">${c.phone}</a>` : '—'}</dd>
            <dt>Adresse</dt><dd>${[c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.country !== 'France' ? c.country : ''].filter(Boolean).join(', ') || '—'}</dd>
            ${c.siret ? html`<dt>Immatriculation</dt><dd class="num">${c.siret}</dd>` : ''}
            ${c.vat_number ? html`<dt>N° fiscal</dt><dd class="num">${c.vat_number}</dd>` : ''}
          </dl>
          ${c.notes ? html`<p class="notes">${c.notes}</p>` : ''}
        </section>
        ${anonymized ? html`<p class="muted quiet">Données personnelles effacées le ${date(c.anonymized_at)}. Les pièces comptables sont conservées.</p>`
          : html`<section class="panel glass-panel danger-zone">
          <h2>Supprimer ce client</h2>
          <p class="muted">${c.quotes.length + c.invoices.length
            ? 'Ce client a des devis ou factures : ses données personnelles seront effacées (RGPD), les pièces comptables conservées.'
            : 'Aucun document lié : le client sera supprimé définitivement.'}</p>
          <button class="btn danger sm" data-delete>${ico('trash-2', { size: 15 })}${c.quotes.length + c.invoices.length ? 'Anonymiser' : 'Supprimer'}</button>
        </section>`}
      </aside>
    </div>
  `);

  root.querySelectorAll('table.data tbody').forEach((t) => bindRowLinks(t, navigate));
  root.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const hasDocs = c.quotes.length + c.invoices.length > 0;
    const ok = await confirmDialog({
      title: hasDocs ? `Anonymiser ${clientName(c)} ?` : `Supprimer ${clientName(c)} ?`,
      body: hasDocs ? 'Nom du contact, email, téléphone, adresse et notes seront effacés définitivement. Cette action est irréversible.' : 'Le client sera supprimé définitivement.',
      confirm: hasDocs ? 'Anonymiser' : 'Supprimer', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/clients/${id}`);
      toast(hasDocs ? 'Client anonymisé' : 'Client supprimé');
      navigate(hasDocs ? `/clients/${id}` : '/clients', { replace: true });
    } catch (err) { toastError(err); }
  });
}
