import { date, money } from '../format.js';
import { html, invoiceStatus } from '../ui.js';
import { renderList } from './doc-list.js';

export const render = (root, ctx) => renderList(root, ctx, {
  title: 'Factures', subtitle: 'Émission, échéances et encaissements.',
  base: '/factures', endpoint: '/invoices', newLabel: 'Nouvelle facture', icon: 'receipt',
  emptyTitle: 'Aucune facture pour le moment', emptyText: 'Convertissez un devis accepté ou créez une facture directement.',
  filters: [['', 'Toutes'], ['draft', 'Brouillons'], ['issued', 'À encaisser'], ['overdue', 'En retard'], ['paid', 'Payées'], ['cancelled', 'Annulées']],
  columns: [['Numéro'], ['Client'], ['Émise le', 'hide-sm'], ['Échéance', 'hide-sm'], ['Statut'], ['Reste dû', 'r hide-sm'], ['Total TTC', 'r']],
  row: (i) => html`<tr data-href="/factures/${i.id}">
    <td class="ref"><a class="row-link" href="/factures/${i.id}" data-link translate="no">${i.number ?? 'Brouillon'}</a></td>
    <td><span class="primary-cell">${i.client_label}</span><span class="sub">${i.title || 'Sans objet'}</span></td>
    <td class="ref hide-sm">${date(i.issue_date)}</td><td class="ref hide-sm">${date(i.due_date)}</td>
    <td>${invoiceStatus(i)}</td>
    <td class="r hide-sm">${i.status === 'issued' ? money(i.total - i.amount_paid) : '—'}</td>
    <td class="r">${money(i.total)}</td></tr>`,
  footer: (rows) => {
    const live = rows.filter((i) => i.status === 'issued' || i.status === 'paid');
    return html`<span>${rows.length} facture${rows.length > 1 ? 's' : ''}</span>
      <span>Reste dû <b class="num">${money(live.reduce((s, i) => s + i.total - i.amount_paid, 0))}</b></span>
      <span>Total TTC émis <b class="num">${money(live.reduce((s, i) => s + i.total, 0))}</b></span>`;
  },
});
