import { api } from '../api.js';
import { busy, errorState, html, ico, mount, toast, toastError } from '../ui.js';

export async function render(root) {
  let s;
  try { s = await api.get('/settings'); }
  catch (err) { mount(root, errorState(err)); return; }

  const f = (name, label, opts = {}) => html`
    <label class="field ${opts.span ? 'span-2' : ''}"><span>${label}</span>
      ${opts.area ? html`<textarea class="input" name="${name}" rows="${opts.rows ?? 3}" placeholder="${opts.placeholder ?? ''}">${s[name]}</textarea>`
      : html`<input class="input ${opts.right ? 'right' : ''}" name="${name}" value="${s[name]}" type="${opts.type ?? 'text'}" ${opts.attrs ? opts.attrs : ''} placeholder="${opts.placeholder ?? ''}">`}
      ${opts.help ? html`<small>${opts.help}</small>` : ''}</label>`;

  mount(root, html`
    <header class="page-head"><div><h1>Paramètres</h1><p>Informations reprises sur vos devis et factures.</p></div></header>
    <form class="split" novalidate>
      <div class="stack">
        <section class="panel glass-panel"><div class="form-section"><h3>Entreprise</h3><div class="form-grid">
          ${f('company_name', 'Nom commercial', { span: true })}
          ${f('company_address', 'Adresse', { span: true, area: true, rows: 2 })}
          ${f('company_email', 'Email', { type: 'email' })}${f('company_phone', 'Téléphone')}
          ${f('company_website', 'Site web')}${f('siret', 'SIRET')}
          ${f('vat_number', 'N° TVA intracommunautaire')}${f('iban', 'IBAN', { help: 'Affiché sur les factures pour le règlement par virement.' })}
        </div></div></section>

        <section class="panel glass-panel"><div class="form-section"><h3>Mentions sur les documents</h3><div class="form-grid">
          ${f('quote_terms', 'Conditions du devis', { span: true, area: true, placeholder: 'Validité, acompte, délais de réalisation…' })}
          ${f('invoice_terms', 'Mentions de la facture', { span: true, area: true, rows: 4, help: 'Pénalités de retard et indemnité forfaitaire de recouvrement : mentions obligatoires entre professionnels. Faites valider ce texte par votre expert-comptable.' })}
        </div></div></section>
      </div>

      <aside class="sticky-side">
        <section class="panel glass-panel"><div class="form-section"><h3>Taxe</h3><div class="form-grid">
          ${f('tax_label', 'Libellé')}${f('tax_rate', 'Taux (%)', { right: true, attrs: 'inputmode="decimal"' })}
          ${f('tax_exempt_mention', 'Mention si taux à 0 %', { span: true, placeholder: 'TVA non applicable, art. 293 B du CGI', help: 'Le taux est figé sur chaque document à sa création : le modifier n’affecte pas les devis et factures existants.' })}
        </div></div></section>
        <section class="panel glass-panel"><div class="form-section"><h3>Numérotation et délais</h3><div class="form-grid">
          ${f('quote_prefix', 'Préfixe devis', { help: 'DEV-2026-0001' })}${f('invoice_prefix', 'Préfixe factures', { help: 'FAC-2026-0001' })}
          ${f('quote_validity_days', 'Validité devis (j)', { right: true, type: 'number', attrs: 'min="0" max="365"' })}
          ${f('payment_terms_days', 'Délai paiement (j)', { right: true, type: 'number', attrs: 'min="0" max="365"' })}
        </div></div></section>
        <button class="btn primary wide" type="submit">${ico('check')}Enregistrer les paramètres</button>
        <section class="panel glass-panel mobile-only"><div class="form-section"><h3>Affichage</h3>
          <div class="segmented" role="group" aria-label="Thème" data-theme-mobile>
            ${[['light', 'Clair'], ['system', 'Système'], ['dark', 'Sombre']].map(([k, l]) => html`<button type="button" data-theme-pick="${k}">${l}</button>`)}
          </div></div>
          <button type="button" class="btn ghost wide" data-logout hidden style="margin-top:var(--s-4)">${ico('log-out')}Se déconnecter</button>
        </section>
      </aside>
    </form>
  `);

  const form = root.querySelector('form');
  // Sur mobile, la barre latérale est remplacée par des onglets : thème et déconnexion vivent ici.
  const themeBox = root.querySelector('[data-theme-mobile]');
  const paintTheme = () => {
    let cur = 'system';
    try { cur = localStorage.getItem('sda-theme') ?? 'system'; } catch {}
    themeBox.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.themePick === cur));
  };
  themeBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-pick]');
    if (!b) return;
    document.querySelector(`[data-theme-set="${b.dataset.themePick}"]`)?.click();
    paintTheme();
  });
  paintTheme();
  const logout = root.querySelector('[data-logout]');
  api.get('/auth/status').then((st) => { logout.hidden = !st.configured; }).catch(() => {});
  logout.addEventListener('click', async () => { await api.post('/auth/logout'); location.href = '/login/'; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.tax_rate = Number(String(data.tax_rate).replace(',', '.'));
    busy(form.querySelector('[type=submit]'), async () => {
      try { s = await api.put('/settings', data); toast('Paramètres enregistrés'); }
      catch (err) { toastError(err); }
    });
  });
}
