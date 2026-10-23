// Étape discover (spec 4.1), en script local : le plan gratuit de Workers ne laisse pas le temps de calcul
// nécessaire pour lire le fichier complet.
//
// Usage (sur l'ordinateur de Mathys, depuis la racine du dépôt) :
//   node scripts/prospection/import-dbpr.mjs --file <fichier DBPR téléchargé> [--local]
//   puis : npx wrangler d1 execute crm-sda --remote --file=.wrangler/prospection/import-dbpr.sql
//
// - Lit les filtres dans prospect_config (classes, comtés, État) : rien n'est en dur.
// - Lit le gabarit de colonnes scripts/prospection/dbpr-layout.json, rempli depuis la doc officielle ;
//   refuse de tourner s'il est incomplet.
// - N'importe ni adresse postale, ni téléphone, ni email : seulement licence, noms, ville, comté, statut.
// - Écrit des INSERT … ON CONFLICT (license_number) DO NOTHING par lots : relancer ne crée aucun doublon.
// - N'écrit dans aucune table du CRM.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadLayout, readCsv } from './lib-dbpr.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = opt('--file');
const out = opt('--out') ?? '.wrangler/prospection/import-dbpr.sql';
const layoutPath = opt('--layout') ?? 'scripts/prospection/dbpr-layout.json';
const local = args.includes('--local');
if (!file) { console.error('Usage : node scripts/prospection/import-dbpr.mjs --file <fichier DBPR> [--local]'); process.exit(1); }

const layout = loadLayout(layoutPath);

const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', local ? '--local' : '--remote', '--json',
  '--command', 'SELECT key, value FROM prospect_config'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const config = Object.fromEntries(JSON.parse(raw)[0].results.map((r) => [r.key, r.value]));
const classes = new Set(config.target_license_classes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
const counties = new Set(config.target_counties.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
const classTrade = JSON.parse(config.license_class_trade);
const state = config.target_state.toUpperCase();
if (config.license_class_codes_verified !== '1') {
  console.warn('⚠ license_class_codes_verified = 0 : les codes de classe n’ont pas été confirmés dans la table officielle.');
}

const col = layout.columns;
const cell = (row, key) => (col[key] === null ? '' : (row[col[key]] ?? '').trim());
const activeValues = new Set(layout.active_status_values.map((v) => v.toUpperCase()));
const countyName = (v) => (layout.county_values === 'code' ? (layout.county_codes?.[v] ?? '') : v).toUpperCase();

const kept = new Map();
const counts = {};
let rows = 0;
let skippedHeader = false;
for await (const row of readCsv(file)) {
  if (layout.has_header_row && !skippedHeader) { skippedHeader = true; continue; }
  rows++;
  const cls = cell(row, 'class_code').toUpperCase();
  if (!classes.has(cls)) continue;
  if (!activeValues.has(cell(row, 'status').toUpperCase())) continue;
  const county = countyName(cell(row, 'county'));
  if (!counties.has(county)) continue;
  if (col.state !== null && cell(row, 'state').toUpperCase() !== state) continue;
  const trade = classTrade[cls];
  if (!trade) throw new Error(`Classe ${cls} sans métier dans license_class_trade`);
  const license = cell(row, 'license_number');
  if (!license) continue;
  if (kept.has(license)) continue; // même licence répétée dans le fichier : une seule ligne
  kept.set(license, {
    license_number: license, license_class: cls, trade,
    legal_name: cell(row, 'licensee_name') || null, dba_name: cell(row, 'dba_name') || null,
    city: cell(row, 'city') || null, county: titleCase(county), state,
    license_status: cell(row, 'status') || null, license_expiry: cell(row, 'expiry_date') || null,
  });
  const key = `${trade}|${titleCase(county)}`;
  counts[key] = (counts[key] ?? 0) + 1;
}

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const fields = ['license_number', 'license_class', 'trade', 'legal_name', 'dba_name', 'city', 'county', 'state', 'license_status', 'license_expiry'];
const values = [...kept.values()];
const statements = [];
for (let i = 0; i < values.length; i += 100) {
  const chunk = values.slice(i, i + 100).map((v) => `(${fields.map((f) => q(v[f])).join(', ')})`);
  statements.push(`INSERT INTO prospect_companies (${fields.join(', ')}) VALUES\n${chunk.join(',\n')}\nON CONFLICT (license_number) DO NOTHING;`);
}
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(out, statements.join('\n') + '\n');
writeFileSync(out.replace(/\.sql$/, '.counts.json'), JSON.stringify(counts, null, 2));

console.log(`${rows} lignes lues, ${values.length} licences retenues → ${out} (${statements.length} lots)`);
printCounts(counts);
console.log(`\nComptage indépendant : python3 scripts/prospection/count-dbpr.py --file ${file}${local ? " --local" : ""}`);

function titleCase(s) { return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
function printCounts(c) {
  const trades = [...new Set(Object.keys(c).map((k) => k.split('|')[0]))].sort();
  const cs = [...new Set(Object.keys(c).map((k) => k.split('|')[1]))].sort();
  console.log(`\n${'métier'.padEnd(10)}${cs.map((x) => x.padStart(14)).join('')}${'total'.padStart(10)}`);
  for (const t of trades) {
    const line = cs.map((x) => c[`${t}|${x}`] ?? 0);
    console.log(`${t.padEnd(10)}${line.map((n) => String(n).padStart(14)).join('')}${String(line.reduce((a, b) => a + b, 0)).padStart(10)}`);
  }
}
