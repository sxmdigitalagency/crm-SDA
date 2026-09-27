const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const FORMATS = new Map();
function fmt(currency, digits) {
  const key = `${currency}:${digits}`;
  if (!FORMATS.has(key)) {
    FORMATS.set(key, new Intl.NumberFormat('fr-FR', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return FORMATS.get(key);
}
export const CURRENCIES = ['EUR', 'USD'];
export const SYMBOL = { EUR: '€', USD: '$US' };
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

/** Montants stockés en centimes. */
// Espace fine (U+202F) quasi invisible dans Geist aux grandes tailles : espace insécable standard.
const nb = (s) => s.replace(/\u202f/g, '\u00a0');
export const money = (cents, currency = 'EUR') => nb(fmt(currency, 2).format((cents ?? 0) / 100));
export const money0 = (cents, currency = 'EUR') => nb(fmt(currency, 0).format(Math.round((cents ?? 0) / 100)));
export const moneyCompact = (cents, currency = 'EUR') => `${nb(compact.format((cents ?? 0) / 100))}\u00a0${SYMBOL[currency] ?? currency}`;

/** Montants par devise, jamais additionnés entre eux : « 1 200,00 € · 800,00 $US ». */
export function moneyByCurrency(list, key = 'amount') {
  const parts = (list ?? []).filter((x) => x[key]).map((x) => money(x[key], x.currency));
  return parts.length ? parts.join(' · ') : money(0);
}
export function sumByCurrency(rows, pick) {
  const acc = {};
  for (const r of rows) acc[r.currency ?? 'EUR'] = (acc[r.currency ?? 'EUR'] ?? 0) + pick(r);
  return Object.entries(acc).map(([currency, amount]) => ({ currency, amount }));
}
export const date = (iso) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T12:00:00`)) : '—');
export const month = (ym) => monthFmt.format(new Date(`${ym}-15T12:00:00`)).replace('.', '');
export const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)} %`);
export const qty = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n);

/** Saisie utilisateur « 1 234,50 » → centimes. */
export function parseMoney(input) {
  const s = String(input ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export const moneyInput = (cents) => ((cents ?? 0) / 100).toFixed(2).replace('.', ',');
export function parseQty(input) {
  const n = Number(String(input ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function relativeDays(days) {
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  if (days === -1) return 'hier';
  return days > 0 ? `dans ${days} j` : `il y a ${-days} j`;
}

export function timeAgo(iso) {
  const t = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return date(iso);
}

export const today = () => new Date().toISOString().slice(0, 10);
