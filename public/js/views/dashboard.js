import { api } from '../api.js';
import { barList, countUp, lineChart } from '../charts.js';
import { money as moneyIn, money0 as money0In, moneyCompact as compactIn, month, pct, relativeDays, timeAgo } from '../format.js';
import { errorState, html, ico, mount } from '../ui.js';

const monthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

function delta(cur, prev, money0) {
  if (!prev && !cur) return html`<span class="delta flat">Aucune activité sur la période précédente</span>`;
  if (!prev) return html`<span class="delta up">${ico('arrow-up-right', { size: 14 })}Nouveau vs même période</span>`;
  const r = (cur - prev) / prev;
  const cls = Math.abs(r) < 0.005 ? 'flat' : r > 0 ? 'up' : 'down';
  const arrow = cls === 'up' ? ico('arrow-up-right', { size: 14 }) : cls === 'down' ? ico('arrow-down-right', { size: 14 }) : ico('minus', { size: 14 });
  return html`<span class="delta ${cls}">${arrow}${r > 0 ? '+' : ''}${Math.round(r * 100)} % <span class="muted">vs ${money0(prev)}</span></span>`;
}

const ACTIVITY = {
  quote: ['file-text', 'Devis créé'],
  invoice: ['receipt', 'Facture émise'],
  payment: ['banknote', 'Paiement reçu'],
  client: ['user-plus', 'Nouveau client'],
};

function skeleton() {
  return html`
    <header class="page-head"><div><h1>Tableau de bord</h1><p>Chargement des indicateurs…</p></div></header>
    <section class="pulse glass-panel" aria-busy="true">${Array.from({ length: 4 }, () => html`<div class="pulse-item"><div class="skeleton" style="width:50%"></div><div class="skeleton" style="height:36px;width:80%;margin-top:12px"></div><div class="skeleton" style="width:60%;margin-top:12px"></div></div>`)}</section>
    <div class="dash-grid"><section class="panel glass-panel"><div class="skeleton" style="height:300px"></div></section><section class="panel glass-panel"><div class="skeleton" style="height:300px"></div></section></div>`;
}

export async function render(root, { navigate, query }) {
  mount(root, skeleton());
  let data;
  try {
    data = await api.get(`/dashboard/stats${query.get('devise') ? `?currency=${encodeURIComponent(query.get('devise'))}` : ''}`);
  } catch (err) {
    mount(root, html`<header class="page-head"><div><h1>Tableau de bord</h1></div></header>${errorState(err, true)}`);
    root.querySelector('[data-retry]')?.addEventListener('click', () => render(root, { navigate, query }));
    return;
  }
  const k = data.kpis;
  const cur = data.currency;
  const money = (c) => moneyIn(c, cur);
  const money0 = (c) => money0In(c, cur);
  const moneyCompact = (c) => compactIn(c, cur);
  const periodLabel = monthLong.format(new Date(`${data.period.current_from}T12:00:00`));
  const day = Number(data.period.current_to.slice(8, 10));
  const hasHistory = data.monthly.some((m) => m.invoiced || m.collected);
  const overdueShare = k.outstanding.amount ? k.outstanding.overdue / k.outstanding.amount : 0;

  mount(root, html`
    <header class="page-head">
      <div>
        <h1>Tableau de bord</h1>
        <p>${periodLabel[0].toUpperCase() + periodLabel.slice(1)} · du 1<sup>er</sup> au ${day}, comparé à la même période du mois précédent${data.currencies.length > 1 ? html` · montants en ${cur === 'EUR' ? 'euros' : 'dollars US'} uniquement` : ''}</p>
      </div>
      <div class="page-actions">
        ${data.currencies.length > 1 ? html`<div class="segmented" role="group" aria-label="Devise affichée">
          ${data.currencies.map((c) => html`<a href="/?devise=${c}" data-link class="seg-link" aria-current="${c === cur ? 'true' : false}">${c === 'EUR' ? '€ Euro' : '$ Dollar'}</a>`)}
        </div>` : ''}
        <a class="btn" href="/factures/new" data-link>${ico('receipt')}Facture</a>
        <a class="btn primary" href="/devis/new" data-link>${ico('plus')}Nouveau devis</a>
      </div>
    </header>

    <section class="pulse glass-panel" aria-label="Indicateurs du mois">
      <div class="pulse-item lead">
        <span class="pulse-label">Facturé TTC</span>
        <span class="pulse-value num" data-count="${k.invoiced.cur}">${money0(k.invoiced.cur)}</span>
        ${delta(k.invoiced.cur, k.invoiced.prev, money0)}
      </div>
      <div class="pulse-item">
        <span class="pulse-label">Encaissé</span>
        <span class="pulse-value num" data-count="${k.collected.cur}">${money0(k.collected.cur)}</span>
        ${delta(k.collected.cur, k.collected.prev, money0)}
      </div>
      <div class="pulse-item">
        <span class="pulse-label">Devis émis HT</span>
        <span class="pulse-value num" data-count="${k.quoted.cur}">${money0(k.quoted.cur)}</span>
        ${delta(k.quoted.cur, k.quoted.prev, money0)}
      </div>
      <div class="pulse-item">
        <span class="pulse-label">Taux de transformation</span>
        <span class="pulse-value num">${pct(k.conversion.rate)}</span>
        <span class="delta flat">${k.conversion.decided ? `${k.conversion.won} gagnés sur ${k.conversion.decided} · 12 mois${data.currencies.length > 1 ? ', toutes devises' : ''}` : 'Pas encore de devis décidé'}</span>
      </div>
    </section>

    <div class="dash-grid">
      <section class="panel glass-panel chart-panel">
        <div class="panel-head">
          <h2>Facturé et encaissé</h2>
          <span class="muted">12 derniers mois · TTC</span>
        </div>
        ${hasHistory
          ? html`<div class="legend" aria-hidden="true"><span><i style="background:var(--series-1)"></i>Facturé</span><span><i style="background:var(--series-2)"></i>Encaissé</span></div>
                 <div id="trend" class="trend"></div>
                 <details class="table-view"><summary>Voir les données en tableau</summary>
                   <table class="data"><thead><tr><th>Mois</th><th class="r">Facturé</th><th class="r">Encaissé</th><th class="r">Devis HT</th></tr></thead>
                   <tbody>${data.monthly.map((m) => html`<tr><td>${month(m.month)} ${m.month.slice(0, 4)}</td><td class="r">${money(m.invoiced)}</td><td class="r">${money(m.collected)}</td><td class="r">${money(m.quoted)}</td></tr>`)}</tbody></table>
                 </details>`
          : html`<div class="empty">${ico('receipt', { size: 28 })}<h3>La courbe apparaîtra avec vos premières factures</h3><p>Émettez une facture ou enregistrez un paiement : l'évolution sur 12 mois se construit automatiquement.</p><a class="btn" href="/factures/new" data-link>Créer une facture</a></div>`}
      </section>

      <section class="panel glass-panel">
        <div class="panel-head"><h2>À encaisser</h2><a class="muted" href="/factures?status=issued" data-link>Tout voir</a></div>
        <div class="owed">
          <span class="owed-value num">${money(k.outstanding.amount)}</span>
          <span class="muted">${k.outstanding.count} facture${k.outstanding.count > 1 ? 's' : ''} en attente de paiement</span>
        </div>
        ${k.outstanding.amount
          ? html`<div class="meter" role="img" aria-label="${Math.round(overdueShare * 100)} % en retard">
                   <span class="meter-fill" style="--w:${overdueShare * 100}%"></span></div>
                 <p class="meter-caption">${k.outstanding.overdue
                   ? html`<span class="badge bad">En retard</span> <span class="num">${money(k.outstanding.overdue)}</span> sur ${k.outstanding.overdue_count} facture${k.outstanding.overdue_count > 1 ? 's' : ''}`
                   : html`<span class="badge ok">À jour</span> Aucune échéance dépassée`}</p>`
          : ''}
        ${data.due.length
          ? html`<ul class="due-list">${data.due.map((d) => html`
              <li><a href="/factures/${d.id}" data-link>
                <span class="due-when ${d.days < 0 ? 'late' : d.days <= 7 ? 'soon' : ''}">${relativeDays(d.days)}</span>
                <span class="due-who"><strong>${d.client_label}</strong><small>${d.number}</small></span>
                <span class="num">${money(d.remaining)}</span>
              </a></li>`)}</ul>`
          : html`<p class="muted quiet">Rien à encaisser pour l'instant.</p>`}
      </section>

      <section class="panel glass-panel">
        <div class="panel-head"><h2>Chiffre d'affaires par activité</h2><span class="muted">12 mois · HT facturé</span></div>
        ${data.categories.length ? html`<div id="cats"></div>` : html`<p class="muted quiet">Les activités apparaîtront quand vos factures utiliseront le catalogue de prestations.</p>`}
        <dl class="portfolio">
          <div><dt>Devis en attente de réponse</dt><dd class="num">${money0(k.pipeline.amount)}</dd><small>${k.pipeline.count} devis · HT</small></div>
          <div><dt>Clients actifs</dt><dd class="num">${k.clients.active}</dd><small>${k.clients.prospects} prospect${k.clients.prospects > 1 ? 's' : ''}</small></div>
          <div><dt>Nouveaux clients</dt><dd class="num">${k.clients.new_this_month}</dd><small>ce mois-ci</small></div>
        </dl>
      </section>

      <section class="panel glass-panel">
        <div class="panel-head"><h2>Activité récente</h2></div>
        ${data.activity.length
          ? html`<ul class="feed">${data.activity.slice(0, 7).map((a) => {
              const [ic, label] = ACTIVITY[a.kind];
              const href = a.kind === 'client' ? `/clients/${a.id}` : a.kind === 'quote' ? `/devis/${a.id}` : `/factures/${a.id}`;
              return html`<li><a href="${href}" data-link><span class="feed-icon ${a.kind}">${ico(ic, { size: 15 })}</span>
                <span class="feed-text"><span class="feed-line"><strong>${label}</strong> · ${a.client_label}</span>
                  <small>${a.ref ? `${a.ref} · ` : ''}${timeAgo(a.at)}</small></span>
                ${a.amount != null ? html`<span class="num feed-amount">${compactIn(a.amount, a.currency)}</span>` : ''}</a></li>`;
            })}</ul>`
          : html`<p class="muted quiet">Aucune activité. Commencez par <a href="/clients/new" data-link>ajouter un client</a>.</p>`}
      </section>
    </div>
  `);

  root.querySelectorAll('[data-count]').forEach((el) => countUp(el, Number(el.dataset.count), money0));

  const cleanups = [];
  const trend = root.querySelector('#trend');
  if (trend) {
    cleanups.push(lineChart(trend, {
      labels: data.monthly.map((m) => month(m.month)),
      series: [
        { key: 'invoiced', label: 'Facturé', color: 'var(--series-1)', values: data.monthly.map((m) => m.invoiced) },
        { key: 'collected', label: 'Encaissé', color: 'var(--series-2)', values: data.monthly.map((m) => m.collected) },
      ],
      format: money,
      formatAxis: moneyCompact,
      tooltipTitle: (i) => `${month(data.monthly[i].month)} ${data.monthly[i].month.slice(0, 4)}`,
    }));
  }
  const cats = root.querySelector('#cats');
  if (cats) barList(cats, data.categories.map((c) => ({ label: c.category, value: c.amount })), { format: money0 });

  return () => cleanups.forEach((fn) => fn?.());
}

