import { date, money } from '../format.js';
import { html, quoteStatus } from '../ui.js';
import { renderList } from './doc-list.js';

export const render = (root, ctx) => renderList(root, ctx, {
  title: 'Devis', subtitle: 'Propositions commerciales et suivi des réponses.',
  base: '/devis', endpoint: '/quotes', newLabel: 'Nouveau devis', icon: 'file-text',
  emptyTitle: 'Aucun devis pour le moment', emptyText: 'Créez un devis à partir de votre catalogue de prestations, puis convertissez-le en facture une fois accepté.',
  filters: [['', 'Tous'], ['draft', 'Brouillons'], ['sent', 'Envoyés'], ['accepted', 'Acceptés'], ['converted', 'Facturés'], ['declined', 'Refusés']],
  columns: [['Numéro'], ['Client'], ['Date', 'hide-sm'], ['Validité', 'hide-sm'], ['Statut'], ['Total HT', 'r']],
  row: (q) => html`<tr data-href="/devis/${q.id}">
    <td class="ref"><a class="row-link" href="/devis/${q.id}" data-link translate="no">${q.number}</a></td>
    <td><span class="primary-cell">${q.client_label}</span><span class="sub">${q.title || 'Sans objet'}</span></td>
    <td class="ref hide-sm">${date(q.issue_date)}</td><td class="ref hide-sm">${date(q.valid_until)}</td>
    <td>${quoteStatus(q)}</td><td class="r">${money(q.subtotal)}</td></tr>`,
  footer: (rows) => html`<span>${rows.length} devis</span><span>Total HT <b class="num">${money(rows.reduce((s, q) => s + q.subtotal, 0))}</b></span>`,
});
