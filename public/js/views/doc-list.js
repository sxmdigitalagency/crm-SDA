import { api } from '../api.js';
import { bindRowLinks, debounce, errorState, html, ico, mount, skeletonRows } from '../ui.js';

/** Liste commune devis / factures : filtres segmentés, recherche, lignes cliquables. */
export async function renderList(root, { navigate, query }, cfg) {
  const state = { q: query.get('q') ?? '', status: query.get('status') ?? '' };

  mount(root, html`
    <header class="page-head">
      <div><h1>${cfg.title}</h1><p>${cfg.subtitle}</p></div>
      <div class="page-actions"><a class="btn primary" href="${cfg.base}/new" data-link>${ico('plus')}${cfg.newLabel}</a></div>
    </header>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Filtrer par statut">
        ${cfg.filters.map(([k, l]) => html`<button type="button" data-status="${k}" aria-pressed="${state.status === k}">${l}</button>`)}
      </div>
      <label class="search">${ico('search', { size: 16 })}<span class="visually-hidden">Rechercher</span>
        <input class="input" type="search" placeholder="Numéro, objet, client…" value="${state.q}" autocomplete="off"></label>
    </div>
    <section class="panel flush glass-panel">
      <div class="table-wrap"><table class="data">
        <thead><tr>${cfg.columns.map(([l, cls]) => html`<th class="${cls ?? ''}">${l}</th>`)}</tr></thead>
        <tbody id="rows">${skeletonRows(7, cfg.columns.length)}</tbody>
      </table></div>
      <div class="list-foot" id="foot" hidden></div>
    </section>
  `);

  const tbody = root.querySelector('#rows');
  const foot = root.querySelector('#foot');
  bindRowLinks(tbody, navigate);

  async function load() {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.status) params.set('status', state.status);
    history.replaceState({}, '', `${cfg.base}${params.size ? `?${params}` : ''}`);
    try {
      const rows = await api.get(`${cfg.endpoint}?${params}`);
      if (!rows.length) {
        foot.hidden = true;
        const filtered = state.q || state.status;
        mount(tbody, html`<tr><td colspan="${cfg.columns.length}"><div class="empty">${ico(cfg.icon, { size: 28 })}
          <h3>${filtered ? 'Aucun résultat' : cfg.emptyTitle}</h3><p>${filtered ? 'Modifiez la recherche ou le filtre.' : cfg.emptyText}</p>
          ${filtered ? '' : html`<a class="btn primary" href="${cfg.base}/new" data-link>${ico('plus')}${cfg.newLabel}</a>`}</div></td></tr>`);
        return;
      }
      mount(tbody, html`${rows.map(cfg.row)}`);
      foot.hidden = false;
      mount(foot, cfg.footer(rows));
    } catch (err) { mount(tbody, html`<tr><td colspan="${cfg.columns.length}">${errorState(err)}</td></tr>`); }
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
