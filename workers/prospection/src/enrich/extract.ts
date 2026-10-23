// Extraction des signaux de la spec 4.2.3, par règles uniquement (aucun LLM).
// Chaque signal produit au plus une ligne de preuve, avec la page où il est vérifiable.
// Signal absent : value « no » et source = page d'accueil (excerpt = pages vérifiées), pour que l'absence
// soit aussi contrôlable. Exception : un signal dont la liste de détection est vide n'est pas émis
// (on ne prétend pas avoir vérifié ce qu'on ne sait pas détecter).
//
// Phase 1 : aucune adresse email n'est collectée. email_public_present dit seulement « oui / non ».
import type { Page } from './crawl';

export interface Evidence { signal: string; value: string | null; source_url: string; excerpt: string | null }

export interface ExtractRules {
  bookingWidgetHosts: string[];
  bookingTextPatterns: string[];
  chatWidgetHosts: string[];
  aiAnsweringSignals: string[];
}

interface Hit { page: Page; value: string | null; excerpt: string | null }

const EXCERPT_MAX = 200;

export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function around(text: string, index: number, length: number): string {
  const pad = Math.max(0, Math.floor((EXCERPT_MAX - length) / 2));
  const s = Math.max(0, index - pad);
  return text.slice(s, s + EXCERPT_MAX).trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function extractSignals(pages: Page[], rules: ExtractRules): Evidence[] {
  if (!pages.length) return [];
  const home = pages[0]!;
  const texts = new Map(pages.map((p) => [p, visibleText(p.html)]));
  const checked = `pages vérifiées : ${pages.map((p) => p.category).join(', ')}`;
  const out: Evidence[] = [];

  const first = (find: (p: Page, text: string) => Hit | null): Hit | null => {
    for (const p of pages) { const h = find(p, texts.get(p)!); if (h) return h; }
    return null;
  };
  const yesNo = (signal: string, hit: Hit | null) => {
    out.push(hit
      ? { signal, value: hit.value ?? 'yes', source_url: hit.page.url, excerpt: hit.excerpt }
      : { signal, value: 'no', source_url: home.url, excerpt: checked });
  };
  const inText = (re: RegExp) => (p: Page, text: string): Hit | null => {
    const m = re.exec(text);
    return m ? { page: p, value: null, excerpt: around(text, m.index, m[0].length) } : null;
  };
  const inHtml = (re: RegExp, value?: (m: RegExpExecArray) => string) => (p: Page): Hit | null => {
    const m = re.exec(p.html);
    return m ? { page: p, value: value ? value(m) : null, excerpt: m[0].slice(0, EXCERPT_MAX) } : null;
  };
  const hostsRe = (hosts: string[]) => new RegExp(`(?:https?:)?//(?:[a-z0-9-]+\\.)*(?:${hosts.map(escape).join('|')})[/"'?]`, 'i');

  // Téléphone : lien tel: d'abord, sinon numéro US visible.
  const phone = first((p, text) => {
    const tel = /href\s*=\s*["']tel:([+\d().\s-]{10,20})["']/i.exec(p.html);
    if (tel) return { page: p, value: normalizePhone(tel[1]!), excerpt: tel[0] };
    const m = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/.exec(text);
    return m ? { page: p, value: `(${m[1]}) ${m[2]}-${m[3]}`, excerpt: around(text, m.index, m[0].length) } : null;
  });
  out.push(phone
    ? { signal: 'phone_present', value: 'yes', source_url: phone.page.url, excerpt: phone.excerpt }
    : { signal: 'phone_present', value: 'no', source_url: home.url, excerpt: checked });
  if (phone) out.push({ signal: 'phone_value', value: phone.value, source_url: phone.page.url, excerpt: phone.excerpt });

  // Email public : présence seulement, l'adresse n'est ni stockée ni citée (consigne phase 1).
  const email = first((p, text) =>
    /href\s*=\s*["']mailto:/i.test(p.html) || /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/.test(text) ? { page: p, value: 'yes', excerpt: null } : null);
  out.push(email
    ? { signal: 'email_public_present', value: 'yes', source_url: email.page.url, excerpt: null }
    : { signal: 'email_public_present', value: 'no', source_url: home.url, excerpt: checked });

  // Formulaire de contact : <form> avec zone de texte ou champ email / téléphone (pas un champ de recherche).
  yesNo('has_contact_form', first((p) => {
    for (const m of p.html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
      const f = m[0];
      if (/role\s*=\s*["']search["']/i.test(f)) continue;
      if (/<textarea\b|type\s*=\s*["'](?:email|tel)["']/i.test(f)) return { page: p, value: null, excerpt: f.slice(0, EXCERPT_MAX) };
    }
    return null;
  }));

  // Réservation en ligne : widget connu (fort) ou texte d'appel à réserver (faible, signalé comme tel).
  const widget = rules.bookingWidgetHosts.length ? first(inHtml(hostsRe(rules.bookingWidgetHosts), (m) => `widget:${m[0].replace(/^.*?\/\//, '').replace(/[/"'?]$/, '')}`)) : null;
  const bookingText = !widget && rules.bookingTextPatterns.length
    ? first((p, text) => { const h = inText(new RegExp(rules.bookingTextPatterns.map(escape).join('|'), 'i'))(p, text); return h ? { ...h, value: 'text_only' } : null; })
    : null;
  yesNo('has_online_booking', widget ?? bookingText);

  if (rules.chatWidgetHosts.length) {
    yesNo('has_chat_widget', first(inHtml(hostsRe(rules.chatWidgetHosts), (m) => m[0].replace(/^.*?\/\//, '').replace(/[/"'?]$/, ''))));
  }

  yesNo('mentions_24_7_or_emergency', first(inText(/\b24\s*\/\s*7\b|\b24\s+hours?\b|\bemergenc(?:y|ies)\b|\bsame[-\s]day\b/i)));

  // Publicité payante : balise Google Ads (AW-…) ou pixel Meta.
  yesNo('has_ads_tracking', first(inHtml(/\bAW-\d{6,12}\b|connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*["']init["']/i, (m) => m[0].toUpperCase().startsWith('AW-') ? 'google_ads' : 'meta_pixel')));

  if (rules.aiAnsweringSignals.length) {
    const re = new RegExp(rules.aiAnsweringSignals.map(escape).join('|'), 'i');
    yesNo('has_ai_answering_signal', first((p, text) => {
      const m = re.exec(p.html);
      return m ? { page: p, value: m[0], excerpt: around(text, Math.max(0, text.search(re)), m[0].length) } : null;
    }));
  }

  // Taille d'équipe : le plus grand nombre cité devant techniciens / camions / employés.
  let team: Hit | null = null;
  let teamN = 0;
  for (const p of pages) {
    const text = texts.get(p)!;
    for (const m of text.matchAll(/\b(\d{1,3})\+?\s+(?:[a-z-]+\s+){0,2}(technicians|techs|trucks|vans|employees|team members|plumbers|roofers|installers)\b/gi)) {
      const n = Number(m[1]);
      if (n > teamN) { teamN = n; team = { page: p, value: `${n} ${m[2]!.toLowerCase()}`, excerpt: around(text, m.index!, m[0].length) }; }
    }
  }
  if (team) out.push({ signal: 'team_size_hint', value: team.value, source_url: team.page.url, excerpt: team.excerpt });

  // Nombre d'établissements : uniquement s'il est écrit en toutes lettres (« 4 locations »).
  const loc = first((p, text) => {
    const m = /\b(\d{1,3})\s+(?:convenient\s+|service\s+)?(locations|offices|branches)\b/i.exec(text);
    return m ? { page: p, value: m[1]!, excerpt: around(text, m.index, m[0].length) } : null;
  });
  if (loc) out.push({ signal: 'locations_count', value: loc.value, source_url: loc.page.url, excerpt: loc.excerpt });

  // Aucune adresse email ne sort de l'extraction, même dans l'extrait d'un autre signal.
  return out.map((e) => ({ ...e, excerpt: e.excerpt ? redactEmails(e.excerpt).slice(0, EXCERPT_MAX) : null }));
}

function redactEmails(s: string): string {
  return s.replace(/mailto:[^"'\s>]*/gi, 'mailto:[email]').replace(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g, '[email]');
}

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw.trim();
}
