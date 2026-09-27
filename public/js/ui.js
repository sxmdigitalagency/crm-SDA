import { icon } from './icons.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Gabarit HTML : les valeurs interpolées sont échappées sauf si marquées raw(). */
const RAW = Symbol('raw');
export const raw = (html) => ({ [RAW]: true, html: String(html) });
export function html(strings, ...values) {
  return raw(strings.reduce((out, s, i) => {
    if (i >= values.length) return out + s;
    const v = values[i];
    const str = Array.isArray(v) ? v.map((x) => (x?.[RAW] ? x.html : esc(x))).join('') : v?.[RAW] ? v.html : v === false || v == null ? '' : esc(v);
    return out + s + str;
  }, ''));
}
export const ico = (name, opts) => raw(icon(name, opts));

export function mount(el, tpl) { el.innerHTML = tpl?.[RAW] ? tpl.html : String(tpl); }

// ── Statuts ────────────────────────────────────────────────
const QUOTE = {
  draft: ['Brouillon', ''], sent: ['Envoyé', 'accent'], accepted: ['Accepté', 'ok'],
  declined: ['Refusé', 'bad'], converted: ['Facturé', 'ok'], expired: ['Expiré', 'warn'],
};
const INVOICE = {
  draft: ['Brouillon', ''], issued: ['À encaisser', 'accent'], paid: ['Payée', 'ok'],
  cancelled: ['Annulée', ''], overdue: ['En retard', 'bad'], partial: ['Partiel', 'warn'],
};
const CLIENT = { prospect: ['Prospect', 'accent'], active: ['Actif', 'ok'], inactive: ['Inactif', ''] };

export function quoteStatus(q) {
  const key = q.status === 'sent' && q.expired ? 'expired' : q.status;
  const [label, tone] = QUOTE[key] ?? [key, ''];
  return html`<span class="badge ${tone}">${label}</span>`;
}
export function invoiceStatus(i) {
  let key = i.status;
  if (key === 'issued' && i.overdue) key = 'overdue';
  else if (key === 'issued' && i.amount_paid > 0) key = 'partial';
  const [label, tone] = INVOICE[key] ?? [key, ''];
  return html`<span class="badge ${tone}">${label}</span>`;
}
export function clientStatus(c) {
  if (c.anonymized_at) return html`<span class="badge">Anonymisé</span>`;
  const [label, tone] = CLIENT[c.status] ?? [c.status, ''];
  return html`<span class="badge ${tone}">${label}</span>`;
}
export const clientName = (c) => c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Sans nom';

// ── Toasts ─────────────────────────────────────────────────
export function toast(message, tone = 'ok') {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast glass-solid ${tone}`;
  el.innerHTML = `${icon(tone === 'bad' ? 'circle-alert' : 'check')}<span></span>`;
  el.querySelector('span').textContent = message;
  host.append(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); }, tone === 'bad' ? 6000 : 3200);
}

export function toastError(err) { toast(err?.message ?? 'Une erreur est survenue', 'bad'); }

// ── Confirmation (actions destructives ou irréversibles) ───
export function confirmDialog({ title, body, confirm = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dialog glass-solid';
    d.innerHTML = `<form method="dialog"><div class="dialog-body"><h2></h2><p></p></div>
      <div class="dialog-actions"><button class="btn ghost" value="cancel">Annuler</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" value="ok" autofocus></button></div></form>`;
    d.querySelector('h2').textContent = title;
    d.querySelector('p').textContent = body;
    d.querySelector('[value="ok"]').textContent = confirm;
    d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
    document.body.append(d);
    d.showModal();
  });
}

/** Désactive un bouton pendant une action asynchrone. */
export async function busy(button, fn) {
  if (!button || button.dataset.loading === 'true') return;
  const original = button.innerHTML;
  button.dataset.loading = 'true';
  button.disabled = true;
  button.innerHTML = `${icon('loader-circle')}<span>${button.textContent.trim()}</span>`;
  try { return await fn(); }
  finally { button.dataset.loading = 'false'; button.disabled = false; button.innerHTML = original; }
}

export function errorState(err, retry) {
  return html`<div class="error-box" role="alert">${ico('circle-alert')}<div><strong>Chargement impossible.</strong>
    <p>${err?.message ?? 'Erreur inconnue'}</p>${retry ? html`<button class="btn sm" data-retry style="margin-top:8px">Réessayer</button>` : ''}</div></div>`;
}

export function skeletonRows(n = 6, cols = 5) {
  return raw(Array.from({ length: n }, () => `<tr>${Array.from({ length: cols }, (_, i) => `<td><div class="skeleton" style="width:${i === 0 ? 70 : 40 + ((i * 17) % 40)}%"></div></td>`).join('')}</tr>`).join(''));
}

/** Lignes cliquables : <tr data-href="/..."> */
export function bindRowLinks(root, navigate) {
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (!tr || e.target.closest('a, button, input')) return;
    if (e.metaKey || e.ctrlKey) window.open(tr.dataset.href, '_blank');
    else navigate(tr.dataset.href);
  });
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
