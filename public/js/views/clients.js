import { api } from '../api.js';
import { moneyByCurrency } from '../format.js';
import { bindRowLinks, clientStatus, debounce, errorState, html, ico, mount, skeletonRows } from '../ui.js';

const FILTERS = [['', 'Tous'], ['active', 'Actifs'], ['prospect', 'Prospects'], ['inactive', 'Inactifs']];

export async function render(root, { query, navigate }) {
  const state = { q: query.get('q') ?? '', status: query.get('status') ?? '' };

  mount(root, html`
    <header class="page-head">
      <div><h1>Clients</h1><p>Coordonnées, historique et chiffre d'affaires par client.</p></div>
      <div class="page-actions"><a class="btn primary" href="/clients/new" data-link>${ico('user-plus')}Nouveau client</a></div>
    </header>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Filtrer par statut">
        ${FILTERS.map(([k, l]) => html`<button type="button" data-status="${k}" aria-pressed="${state.status === k}">${l}</button>`)}
      </div>
      <label class="search">${ico('search', { size: 16 })}<span class="visually-hidden">Rechercher</span>
        <input class="input" type="search" placeholder="Nom, email, ville…" value="${state.q}" autocomplete="off"></label>
    </div>
    <section class="panel flush glass-panel"><div class="table-wrap"><table class="data">
      <thead><tr><th>Client</th><th class="hide-sm">Contact</th><th>Statut</th><th class="r hide-sm">Devis</th><th class="r">Facturé</th><th class="r hide-sm">Encaissé</th></tr></thead>
      <tbody id="rows">${skeletonRows(6, 6)}</tbody></table></div></section>
  `);

  const tbody = root.querySelector('#rows');
  bindRowLinks(tbody, navigate);

  async function load() {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.status) params.set('status', state.status);
    history.replaceState({}, '', `/clients${params.size ? `?${params}` : ''}`);
    try {
      const rows = await api.get(`/clients?${params}`);
      if (!rows.length) {
        mount(tbody, html`<tr><td colspan="6"><div class="empty">${ico('users', { size: 28 })}
          <h3>${state.q || state.status ? 'Aucun client ne correspond' : 'Aucun client pour le moment'}</h3>
          <p>${state.q || state.status ? 'Modifiez la recherche ou le filtre.' : 'Ajoutez votre premier client pour lui préparer un devis.'}</p>
          ${state.q || state.status ? '' : html`<a class="btn primary" href="/clients/new" data-link>${ico('user-plus')}Ajouter un client</a>`}</div></td></tr>`);
        return;
      }
      mount(tbody, html`${rows.map((c) => html`
        <tr data-href="/clients/${c.id}">
          <td><a class="primary-cell" href="/clients/${c.id}" data-link style="color:inherit;text-decoration:none">${c.label}</a>
            <span class="sub">${c.type === 'pro' ? 'Professionnel' : 'Particulier'}${c.city ? ` · ${c.city}` : ''}</span></td>
          <td class="hide-sm">${c.company_name ? [c.first_name, c.last_name].filter(Boolean).join(' ') : ''}<span class="sub">${c.email || c.phone || '—'}</span></td>
          <td>${clientStatus(c)}</td>
          <td class="r hide-sm">${c.quote_count}</td>
          <td class="r">${moneyByCurrency(c.totals, 'invoiced')}</td>
          <td class="r hide-sm">${moneyByCurrency(c.totals, 'paid')}</td>
        </tr>`)}`);
    } catch (err) { mount(tbody, html`<tr><td colspan="6">${errorState(err)}</td></tr>`); }
  }

  root.querySelector('.segmented').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    state.status = b.dataset.status;
    root.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    load();
  });
  root.querySelector('input[type=search]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); load(); }, 220));
  load();
}
