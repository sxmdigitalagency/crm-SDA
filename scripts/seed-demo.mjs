// Données de DÉMONSTRATION — base LOCALE uniquement.
// Clients, prestations et montants sont fictifs : ils servent à juger le rendu, pas à facturer.
// Usage : npm run db:seed:local   (efface les données locales existantes)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

if (process.argv.includes('--remote')) {
  console.error('Refusé : le seed de démo ne s’applique jamais à la base distante.');
  process.exit(1);
}

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => Math.floor(a + rand() * (b - a + 1));
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() - n); return d; };
const plus = (dateStr, n) => { const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

const services = [
  ['Site web', 'Site vitrine 5 pages', 'Design sur mesure, responsive, SEO de base', 'forfait', 180000],
  ['Site web', 'Site e-commerce', 'Boutique, paiement en ligne, gestion des stocks', 'forfait', 420000],
  ['Site web', 'Landing page', 'Page de conversion unique, formulaire de contact', 'forfait', 65000],
  ['Automatisation', 'Automatisation de workflow', 'Intégration outils (CRM, email, tableur)', 'forfait', 90000],
  ['Automatisation', 'Agent de réponse email', 'Tri et brouillons de réponse automatiques', 'forfait', 150000],
  ['SEO', 'Audit SEO', 'Audit technique et sémantique, plan d’action', 'forfait', 45000],
  ['SEO', 'Accompagnement SEO', 'Suivi mensuel, contenus, netlinking', 'mois', 60000],
  ['Réseaux sociaux', 'Gestion réseaux sociaux', '12 publications / mois, 2 réseaux', 'mois', 55000],
  ['Maintenance', 'Maintenance & hébergement', 'Mises à jour, sauvegardes, monitoring', 'mois', 9000],
  ['Conseil', 'Journée de conseil', 'Atelier stratégie digitale', 'jour', 60000],
  ['Conseil', 'Heure de développement', 'Évolutions ponctuelles', 'heure', 6500],
];

const companies = [
  ['pro', 'Boulangerie Delorme', 'Claire', 'Delorme', 'Lyon'],
  ['pro', 'Atelier Nordik', 'Jonas', 'Berg', 'Lille'],
  ['pro', 'Cabinet Morel Avocats', 'Sophie', 'Morel', 'Paris'],
  ['pro', 'Garage des Pins', 'Karim', 'Benali', 'Toulouse'],
  ['pro', 'Studio Yoga Lumen', 'Inès', 'Carvalho', 'Bordeaux'],
  ['pro', 'Domaine Castel', 'Hugo', 'Castel', 'Montpellier'],
  ['pro', 'Opti Vision', 'Marc', 'Lefebvre', 'Nantes'],
  ['pro', 'Les Toits d’Azur', 'Léa', 'Rossi', 'Nice'],
  ['particulier', '', 'Thomas', 'Girard', 'Rennes'],
  ['pro', 'Kinetik Sport', 'Nadia', 'Haddad', 'Marseille'],
  ['pro', 'Maison Arlette', 'Paul', 'Arlette', 'Strasbourg'],
  ['particulier', '', 'Emma', 'Laurent', 'Grenoble'],
  ['pro', 'Bureau Pixel', 'Yanis', 'Mercier', 'Paris'],
  ['pro', 'Fleurs & Sens', 'Camille', 'Petit', 'Dijon'],
];

const sql = [
  '-- GÉNÉRÉ PAR scripts/seed-demo.mjs — DONNÉES DE DÉMO, LOCAL UNIQUEMENT',
  'PRAGMA defer_foreign_keys = true;',
  'DELETE FROM payments; DELETE FROM line_items; DELETE FROM invoices; DELETE FROM quotes;',
  'DELETE FROM services; DELETE FROM clients; DELETE FROM counters; DELETE FROM sessions;',
  "DELETE FROM sqlite_sequence WHERE name IN ('payments','line_items','invoices','quotes','services','clients');",
  `UPDATE settings SET company_name='SDA Digital Agency', company_address='12 rue de l’Exemple\n75000 Paris',
     company_email='contact@sda.example', company_phone='06 00 00 00 00', company_website='sda.example',
     siret='000 000 000 00000', iban='FR76 0000 0000 0000 0000 0000 000', tax_rate=20.0,
     quote_terms='Devis valable 30 jours. Acompte de 30 % à la signature, solde à la livraison.' WHERE id = 1;`,
];

services.forEach(([cat, name, desc, unit, price], i) =>
  sql.push(`INSERT INTO services (id, category, name, description, unit, unit_price) VALUES (${i + 1}, ${q(cat)}, ${q(name)}, ${q(desc)}, ${q(unit)}, ${price});`));

companies.forEach(([type, company, first, last, city], i) => {
  const created = iso(daysAgo(between(20, 380)));
  const slug = (company || `${first}.${last}`).toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  sql.push(`INSERT INTO clients (id, type, status, company_name, first_name, last_name, email, phone, city, postal_code, created_at)
    VALUES (${i + 1}, ${q(type)}, ${q(i < 10 ? 'active' : 'prospect')}, ${q(company)}, ${q(first)}, ${q(last)},
    ${q(`contact@${slug}.example`)}, ${q(`06 ${between(10, 99)} ${between(10, 99)} ${between(10, 99)} ${between(10, 99)}`)},
    ${q(city)}, ${q(String(between(10, 95)).padStart(2, '0') + '000')}, ${q(created + ' 10:00:00')});`);
});

const counters = {};
const number = (kind, prefix, date) => {
  const key = `${kind}:${date.slice(0, 4)}`;
  counters[key] = (counters[key] ?? 0) + 1;
  return `${prefix}-${date.slice(0, 4)}-${String(counters[key]).padStart(4, '0')}`;
};

let lineId = 1, invoiceId = 1, quoteId = 1;
const docs = [];
for (let n = 0; n < 34; n++) docs.push(daysAgo(between(0, 350)));
docs.sort((a, b) => a - b);

for (const issued of docs) {
  const issue = iso(issued);
  const age = Math.round((today - issued) / 86400000);
  const clientId = between(1, companies.length);
  const lines = [];
  const used = new Set();
  for (let k = 0; k < between(1, 3); k++) {
    let s; do { s = between(1, services.length); } while (used.has(s)); used.add(s);
    const [, name, desc, unit, price] = services[s - 1];
    const quantity = unit === 'mois' ? pick([3, 6, 12]) : unit === 'heure' ? between(4, 20) : unit === 'jour' ? between(1, 3) : 1;
    lines.push({ s, name, desc, unit, price, quantity, amount: Math.round(price * quantity) });
  }
  const gross = lines.reduce((t, l) => t + l.amount, 0);
  const discount = rand() < 0.2 ? Math.round(gross * 0.1 / 100) * 100 : 0;
  const subtotal = gross - discount;
  const tax = Math.round(subtotal * 0.2);
  const total = subtotal + tax;
  const title = lines[0].name;

  // Devis récents : en attente ; anciens : majoritairement gagnés.
  const r = rand();
  const status = age < 25 ? (r < 0.25 ? 'draft' : r < 0.85 ? 'sent' : 'accepted') : r < 0.62 ? 'converted' : r < 0.8 ? 'declined' : r < 0.9 ? 'accepted' : 'sent';

  const qid = quoteId++;
  let invId = null;
  if (status === 'converted') {
    invId = invoiceId++;
    const invIssue = plus(issue, between(3, 12));
    const invAge = Math.round((today - new Date(invIssue)) / 86400000);
    if (invAge < 0) { invoiceId--; invId = null; }
    else {
      const due = plus(invIssue, 30);
      let paid = 0;
      const pays = [];
      const pr = rand();
      if (invAge > 40 ? pr < 0.9 : pr < 0.5) {
        if (rand() < 0.3) {
          const deposit = Math.round(total * 0.3);
          pays.push([deposit, plus(invIssue, between(0, 5))]);
          if (invAge > 25) pays.push([total - deposit, plus(invIssue, between(20, Math.min(45, invAge)))]);
        } else pays.push([total, plus(invIssue, between(2, Math.max(2, Math.min(40, invAge))))]);
      } else if (rand() < 0.4) pays.push([Math.round(total * 0.3), plus(invIssue, between(0, Math.max(0, Math.min(5, invAge))))]);
      pays.forEach(([a]) => (paid += a));
      const invStatus = paid >= total ? 'paid' : 'issued';
      sql.push(`INSERT INTO invoices (id, number, client_id, quote_id, title, status, issue_date, due_date, tax_rate, discount, subtotal, tax_amount, total, amount_paid, created_at, updated_at)
        VALUES (${invId}, ${q(number('invoice', 'FAC', invIssue))}, ${clientId}, ${qid}, ${q(title)}, ${q(invStatus)}, ${q(invIssue)}, ${q(due)}, 20.0, ${discount}, ${subtotal}, ${tax}, ${total}, ${paid}, ${q(invIssue + ' 09:30:00')}, ${q(invIssue + ' 09:30:00')});`);
      lines.forEach((l, i) => sql.push(`INSERT INTO line_items (id, document_type, document_id, position, service_id, description, details, quantity, unit, unit_price, amount)
        VALUES (${lineId++}, 'invoice', ${invId}, ${i}, ${l.s}, ${q(l.name)}, ${q(l.desc)}, ${l.quantity}, ${q(l.unit)}, ${l.price}, ${l.amount});`));
      pays.forEach(([a, d]) => { if (d <= iso(today)) sql.push(`INSERT INTO payments (invoice_id, amount, paid_at, method, created_at) VALUES (${invId}, ${a}, ${q(d)}, ${q(pick(['virement', 'virement', 'carte', 'cheque']))}, ${q(d + ' 14:00:00')});`); });
    }
  }
  sql.push(`INSERT INTO quotes (id, number, client_id, title, status, issue_date, valid_until, tax_rate, discount, subtotal, tax_amount, total, invoice_id, created_at, updated_at)
    VALUES (${qid}, ${q(number('quote', 'DEV', issue))}, ${clientId}, ${q(title)}, ${q(invId ? 'converted' : status === 'converted' ? 'accepted' : status)}, ${q(issue)}, ${q(plus(issue, 30))}, 20.0, ${discount}, ${subtotal}, ${tax}, ${total}, ${invId ?? 'NULL'}, ${q(issue + ' 11:00:00')}, ${q(issue + ' 11:00:00')});`);
  lines.forEach((l, i) => sql.push(`INSERT INTO line_items (id, document_type, document_id, position, service_id, description, details, quantity, unit, unit_price, amount)
    VALUES (${lineId++}, 'quote', ${qid}, ${i}, ${l.s}, ${q(l.name)}, ${q(l.desc)}, ${l.quantity}, ${q(l.unit)}, ${l.price}, ${l.amount});`));
}

// Un client existe avant son premier document.
sql.push(`UPDATE clients SET created_at = MIN(created_at, COALESCE((SELECT MIN(issue_date) FROM quotes WHERE client_id = clients.id), created_at) || ' 09:00:00');`);
// Montant payé recalculé depuis les paiements réellement insérés (dates futures exclues).
sql.push(`UPDATE invoices SET amount_paid = COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = invoices.id), 0);`);
sql.push(`UPDATE invoices SET status = CASE WHEN amount_paid >= total THEN 'paid' ELSE 'issued' END WHERE status IN ('issued','paid');`);
for (const [scope, value] of Object.entries(counters)) sql.push(`INSERT INTO counters (scope, value) VALUES (${q(scope)}, ${value});`);

mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/demo-seed.sql', sql.join('\n') + '\n');
execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', '--local', '--file=.wrangler/demo-seed.sql'], { stdio: 'inherit' });
console.log('Seed de démo appliqué (local).');
