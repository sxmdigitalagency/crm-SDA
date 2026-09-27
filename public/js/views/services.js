import { api } from '../api.js';
import { money, moneyInput, parseMoney } from '../format.js';
import { busy, confirmDialog, errorState, html, ico, mount, toast, toastError } from '../ui.js';

const UNITS = ['forfait', 'heure', 'jour', 'mois', 'unité'];
const SUGGESTED = ['Site web', 'SEO', 'Automatisation', 'Réseaux sociaux', 'Maintenance', 'Conseil'];

export async function render(root) {
  let services;
  try { services = await api.get('/services?all=1'); }
  catch (err) { mount(root, errorState(err)); return; }
  let editing = null; // id en cours d'édition, ou 'new'

  const categories = [...new Set([...SUGGESTED, ...services.map((s) => s.category)])];

  const editor = (s = { category: categories[0], name: '', description: '', unit: 'forfait', unit_price: 0, active: 1 }) => html`
    <form class="service-form glass-solid" data-form="${s.id ?? 'new'}" novalidate>
      <div class="form-grid">
        <label class="field"><span>Nom</span><input class="input" name="name" value="${s.name}" required placeholder="Ex. Site vitrine 5 pages…" autofocus></label>
        <label class="field"><span>Catégorie</span><input class="input" name="category" value="${s.category}" list="cats"></label>
        <label class="field span-2"><span>Description (reprise sur le devis)</span><textarea class="input" name="description" rows="2">${s.description}</textarea></label>
        <label class="field"><span>Unité</span><select class="input" name="unit">${UNITS.map((u) => html`<option ${u === s.unit ? 'selected' : ''}>${u}</option>`)}</select></label>
        <label class="field"><span>Prix unitaire HT (€)</span><input class="input right" name="unit_price" inputmode="decimal" value="${moneyInput(s.unit_price)}"></label>
      </div>
      <div class="form-actions">
        ${s.id ? html`<label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Proposée dans les devis</label>` : html`<span></span>`}
        <span class="spacer"></span>
        ${s.id ? html`<button type="button" class="btn danger sm" data-delete="${s.id}">${ico('trash-2', { size: 15 })}Supprimer</button>` : ''}
        <button type="button" class="btn ghost" data-cancel>Annuler</button>
        <button class="btn primary" type="submit">${ico('check')}${s.id ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>`;

  function paint() {
    const groups = services.reduce((acc, s) => ((acc[s.category] ??= []).push(s), acc), {});
    mount(root, html`
      <header class="page-head">
        <div><h1>Prestations</h1><p>Votre catalogue : ajoutez une prestation à un devis en un clic, le prix reste modifiable ligne par ligne.</p></div>
        <div class="page-actions"><button class="btn primary" data-new ${editing === 'new' ? 'disabled' : ''}>${ico('plus')}Nouvelle prestation</button></div>
      </header>
      <datalist id="cats">${categories.map((c) => html`<option value="${c}">`)}</datalist>
      ${editing === 'new' ? editor() : ''}
      ${services.length ? html`<div class="stack">${Object.entries(groups).map(([cat, list]) => html`
        <section class="panel flush glass-panel">
          <div class="panel-head"><h2>${cat}</h2><span class="muted">${list.length}</span></div>
          <ul class="service-list">${list.map((s) => editing === s.id ? html`<li>${editor(s)}</li>` : html`
            <li class="${s.active ? '' : 'inactive'}"><button class="service-row" data-edit="${s.id}">
              <span class="service-name"><strong>${s.name}</strong><small>${s.description || 'Sans description'}</small></span>
              ${s.active ? '' : html`<span class="badge">Masquée</span>`}
              <span class="service-price num">${money(s.unit_price)}<small>/ ${s.unit}</small></span>
              ${ico('pencil', { size: 15 })}
            </button></li>`)}</ul>
        </section>`)}</div>`
      : editing ? '' : html`<section class="panel glass-panel"><div class="empty">${ico('package', { size: 28 })}<h3>Catalogue vide</h3>
          <p>Enregistrez vos prestations récurrentes (site, SEO, maintenance…) avec leur prix de référence pour composer vos devis plus vite.</p>
          <button class="btn primary" data-new>${ico('plus')}Ajouter une prestation</button></div></section>`}
    `);
    root.querySelector('form [name=name]')?.focus();
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-new], [data-edit], [data-cancel], [data-delete]');
    if (!t) return;
    if (t.matches('[data-new]')) { editing = 'new'; paint(); }
    else if (t.matches('[data-edit]')) { editing = Number(t.dataset.edit); paint(); }
    else if (t.matches('[data-cancel]')) { editing = null; paint(); }
    else if (t.matches('[data-delete]')) {
      const s = services.find((x) => x.id === Number(t.dataset.delete));
      if (!(await confirmDialog({ title: `Supprimer « ${s.name} » ?`, body: 'Les devis et factures existants ne sont pas modifiés. Pour simplement la retirer des nouveaux devis, décochez « Proposée dans les devis ».', confirm: 'Supprimer', danger: true }))) return;
      try { await api.del(`/services/${s.id}`); services = services.filter((x) => x.id !== s.id); editing = null; toast('Prestation supprimée'); paint(); }
      catch (err) { toastError(err); }
    }
  });

  root.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (!fd.name.trim()) { form.name.setAttribute('aria-invalid', 'true'); form.name.focus(); return; }
    const body = { ...fd, unit_price: parseMoney(fd.unit_price), active: form.active ? form.active.checked : true };
    busy(form.querySelector('[type=submit]'), async () => {
      try {
        if (form.dataset.form === 'new') await api.post('/services', body);
        else await api.put(`/services/${form.dataset.form}`, body);
        services = await api.get('/services?all=1');
        editing = null;
        toast('Catalogue mis à jour');
        paint();
      } catch (err) { toastError(err); }
    });
  });

  paint();
}
