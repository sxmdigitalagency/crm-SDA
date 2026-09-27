import { api } from '../api.js';
import { busy, clientName, errorState, html, ico, mount, raw, toast, toastError } from '../ui.js';

const FIELDS = {
  company: [['company_name', 'Raison sociale', 'span-2'], ['siret', 'N° d’immatriculation (SIRET, KvK…)'], ['vat_number', 'N° fiscal (CRIB, TVA…)']],
  contact: [['first_name', 'Prénom'], ['last_name', 'Nom'], ['email', 'Email', '', 'email'], ['phone', 'Téléphone', '', 'tel']],
  address: [['address', 'Adresse', 'span-2'], ['postal_code', 'Code postal'], ['city', 'Ville'], ['country', 'Pays']],
};

export async function render(root, { match, navigate }) {
  const id = match[1] === 'new' ? null : Number(match[1].split('/')[0]);
  let c, settings;
  try {
    [settings, c] = await Promise.all([api.get('/settings'), id ? api.get(`/clients/${id}`) : null]);
  } catch (err) { mount(root, errorState(err)); return; }
  c ??= { type: 'pro', status: 'prospect', country: 'Saint-Martin', currency: settings.default_currency, tax_rate: null };
  const rateLabel = `${settings.tax_label} ${String(settings.tax_rate).replace('.', ',')} %`;

  const input = ([name, label, cls = '', type = 'text']) => html`
    <label class="field ${cls}"><span>${label}</span><input class="input" name="${name}" type="${type}" value="${c[name] ?? ''}" autocomplete="off" ${type === 'email' || name === 'siret' || name === 'vat_number' ? raw('spellcheck="false"') : ''}></label>`;

  mount(root, html`
    <a class="back" href="${id ? `/clients/${id}` : '/clients'}" data-link>${ico('arrow-left', { size: 14 })}${id ? clientName(c) : 'Clients'}</a>
    <header class="page-head"><div><h1>${id ? 'Modifier le client' : 'Nouveau client'}</h1></div></header>
    <form class="panel glass-panel form-panel" novalidate>
      <div class="form-section">
        <div class="form-grid">
          <div class="field"><span>Type</span>
            <div class="segmented" role="radiogroup" aria-label="Type de client">
              <button type="button" data-type="pro" aria-pressed="${c.type === 'pro'}">${ico('building-2', { size: 15 })}Professionnel</button>
              <button type="button" data-type="particulier" aria-pressed="${c.type === 'particulier'}">${ico('user', { size: 15 })}Particulier</button>
            </div></div>
          <label class="field"><span>Statut</span><select class="input" name="status">
            ${[['prospect', 'Prospect'], ['active', 'Actif'], ['inactive', 'Inactif']].map(([v, l]) => html`<option value="${v}" ${c.status === v ? 'selected' : ''}>${l}</option>`)}
          </select></label>
        </div>
      </div>
      <div class="form-section"><h3>Facturation</h3><div class="form-grid">
        <label class="field"><span>Devise</span><select class="input" name="currency">
          <option value="EUR" ${c.currency === 'EUR' ? 'selected' : ''}>Euro (€)</option>
          <option value="USD" ${c.currency === 'USD' ? 'selected' : ''}>Dollar US ($US)</option>
        </select><small>Proposée par défaut sur ses devis et factures.</small></label>
        <label class="field"><span>Taux de taxe (%)</span>
          <input class="input right" name="tax_rate" inputmode="decimal" value="${c.tax_rate == null ? '' : String(c.tax_rate).replace('.', ',')}" placeholder="${`Par défaut : ${rateLabel}…`}" autocomplete="off">
          <small>Laissez vide pour appliquer le taux par défaut. Pour un client hors de Saint-Martin, faites valider le taux par votre comptable.</small></label>
      </div></div>
      <div class="form-section" data-company ${c.type === 'particulier' ? 'hidden' : ''}><h3>Entreprise</h3><div class="form-grid">${FIELDS.company.map(input)}</div></div>
      <div class="form-section"><h3>Contact</h3><div class="form-grid">${FIELDS.contact.map(input)}</div></div>
      <div class="form-section"><h3>Adresse de facturation</h3><div class="form-grid">${FIELDS.address.map(input)}</div></div>
      <div class="form-section"><h3>Notes internes</h3>
        <label class="field"><span class="visually-hidden">Notes</span><textarea class="input" name="notes" rows="3" placeholder="Contexte, besoins, préférences de contact…">${c.notes ?? ''}</textarea></label></div>
      <p class="form-error" role="alert"></p>
      <div class="form-actions">
        <a class="btn ghost" href="${id ? `/clients/${id}` : '/clients'}" data-link>Annuler</a>
        <button class="btn primary" type="submit">${ico('check')}${id ? 'Enregistrer' : 'Créer le client'}</button>
      </div>
    </form>
  `);

  const form = root.querySelector('form');
  let type = c.type;
  form.querySelector('[role=radiogroup]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    type = b.dataset.type;
    form.querySelectorAll('[data-type]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    form.querySelector('[data-company]').hidden = type === 'particulier';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.type = type;
    data.tax_rate = data.tax_rate.trim() === '' ? '' : data.tax_rate.replace(',', '.');
    if (type === 'particulier') { data.company_name = ''; data.siret = ''; data.vat_number = ''; }
    const err = form.querySelector('.form-error');
    err.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    if (!data.company_name && !data.last_name) {
      err.textContent = type === 'pro' ? 'Indiquez la raison sociale ou le nom du contact.' : 'Indiquez le nom du client.';
      form.querySelector(`[name=${type === 'pro' ? 'company_name' : 'last_name'}]`).setAttribute('aria-invalid', 'true');
      form.querySelector('[aria-invalid]').focus();
      return;
    }
    busy(form.querySelector('[type=submit]'), async () => {
      try {
        const res = id ? await api.put(`/clients/${id}`, data) : await api.post('/clients', data);
        toast(id ? 'Client mis à jour' : 'Client créé');
        navigate(`/clients/${res.id}`, { replace: true });
      } catch (e2) { err.textContent = e2.message; toastError(e2); }
    });
  });
}
