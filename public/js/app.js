import { api } from './api.js';
import { icon } from './icons.js';

const NAV = [
  { href: '/', label: 'Tableau de bord', short: 'Accueil', icon: 'layout-dashboard', match: /^\/$/ },
  { href: '/clients', label: 'Clients', icon: 'users', match: /^\/clients/ },
  { href: '/devis', label: 'Devis', icon: 'file-text', match: /^\/devis/ },
  { href: '/factures', label: 'Factures', icon: 'receipt', match: /^\/factures/ },
  { href: '/prestations', label: 'Prestations', short: 'Catalogue', icon: 'package', match: /^\/prestations/ },
  { href: '/parametres', label: 'Paramètres', short: 'Réglages', icon: 'settings', match: /^\/parametres/ },
];

const ROUTES = [
  [/^\/$/, () => import('./views/dashboard.js')],
  [/^\/clients$/, () => import('./views/clients.js')],
  [/^\/clients\/(new|\d+\/edit)$/, () => import('./views/client-form.js')],
  [/^\/clients\/(\d+)$/, () => import('./views/client.js')],
  [/^\/devis$/, () => import('./views/quotes.js')],
  [/^\/factures$/, () => import('./views/invoices.js')],
  [/^\/(devis|factures)\/(new|\d+)$/, () => import('./views/document.js')],
  [/^\/prestations$/, () => import('./views/services.js')],
  [/^\/parametres$/, () => import('./views/settings.js')],
];

const view = document.getElementById('view');
let cleanup = null;
let renderToken = 0;

export function navigate(href, { replace = false } = {}) {
  const url = new URL(href, location.origin);
  if (url.pathname + url.search === location.pathname + location.search && !replace) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  render();
}

// ── Navigation ─────────────────────────────────────────────
const nav = document.getElementById('nav');
nav.innerHTML = `<span class="nav-lens" aria-hidden="true"></span>` + NAV.map(
  (n) => `<a href="${n.href}" data-link>${icon(n.icon)}<span class="label-long">${n.label}</span><span class="label-short" aria-hidden="true">${n.short ?? n.label}</span></a>`,
).join('');
const lens = nav.querySelector('.nav-lens');

function updateNav() {
  let active = null;
  nav.querySelectorAll('a').forEach((a, i) => {
    const on = NAV[i].match.test(location.pathname);
    if (on) { a.setAttribute('aria-current', 'page'); active = a; } else a.removeAttribute('aria-current');
  });
  if (active) {
    lens.style.opacity = '1';
    lens.style.height = `${active.offsetHeight}px`;
    lens.style.transform = `translateY(${active.offsetTop}px)`;
  } else lens.style.opacity = '0';
}

// ── Thème ──────────────────────────────────────────────────
const THEMES = [['light', 'sun', 'Clair'], ['system', 'monitor', 'Système'], ['dark', 'moon', 'Sombre']];
const themeSwitch = document.getElementById('theme-switch');
function currentTheme() { try { return localStorage.getItem('sda-theme') ?? 'system'; } catch { return 'system'; } }
function setTheme(t) {
  try { t === 'system' ? localStorage.removeItem('sda-theme') : localStorage.setItem('sda-theme', t); } catch {}
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  paintThemeSwitch();
  window.dispatchEvent(new Event('themechange'));
}
function paintThemeSwitch() {
  const cur = currentTheme();
  themeSwitch.innerHTML = THEMES.map(([k, ic, label]) =>
    `<button type="button" data-theme-set="${k}" aria-pressed="${cur === k}" title="${label}" aria-label="Thème ${label.toLowerCase()}">${icon(ic, { size: 16 })}</button>`).join('');
}
themeSwitch.addEventListener('click', (e) => { const b = e.target.closest('[data-theme-set]'); if (b) setTheme(b.dataset.themeSet); });
paintThemeSwitch();

// ── Déconnexion (visible seulement si l'auth est active) ───
const logout = document.getElementById('logout');
logout.querySelector('.logout-icon').innerHTML = icon('log-out');
api.get('/auth/status').then((s) => { logout.hidden = !s.configured; }).catch(() => {});
logout.addEventListener('click', async () => { await api.post('/auth/logout'); location.href = '/login/'; });

// ── Liens internes ─────────────────────────────────────────
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  const url = new URL(a.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || a.hasAttribute('download')) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener('popstate', render);
window.addEventListener('resize', updateNav);

// ── Rendu ──────────────────────────────────────────────────
async function render() {
  const token = ++renderToken;
  updateNav();
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  const path = location.pathname.replace(/\/+$/, '') || '/';
  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) {
    view.innerHTML = `<div class="empty">${icon('inbox', { size: 28 })}<h3>Page introuvable</h3><p>Cette adresse ne correspond à aucune page du CRM.</p><a class="btn" href="/" data-link>Retour au tableau de bord</a></div>`;
    return;
  }
  const match = path.match(route[0]);
  const mod = await route[1]();
  if (token !== renderToken) return;
  view.classList.remove('view-enter');
  void view.offsetWidth;
  view.classList.add('view-enter');
  window.scrollTo({ top: 0 });
  cleanup = await mod.render(view, { match, query: new URLSearchParams(location.search), navigate });
  const h1 = view.querySelector('h1');
  document.title = h1 ? `${h1.textContent.trim()} · SDA` : 'SDA · CRM';
}

render();
