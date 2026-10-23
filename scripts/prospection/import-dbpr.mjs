// Étape discover (spec 4.1), en script local : le plan gratuit de Workers ne laisse pas le temps de calcul
// nécessaire pour lire le fichier complet.
//
// Usage (sur l'ordinateur de Mathys, depuis la racine du dépôt) :
//   node scripts/prospection/import-dbpr.mjs --file <fichier DBPR téléchargé> [--local] [--force]
//   python3 scripts/prospection/count-dbpr.py --file <même fichier>          (comptage indépendant)
//   npx wrangler d1 execute crm-sda --remote --file=.wrangler/prospection/import-dbpr.sql
//
// - Filtres lus dans prospect_config (classes, comtés, État) ; colonnes lues dans dbpr-layout.json, rempli depuis
//   la doc officielle (le script refuse de tourner sinon).
// - N'importe ni adresse postale, ni téléphone, ni email : licence, noms, ville, comté, statut, expiration.
// - Nouvelles licences du filtre (actives) : INSERT … ON CONFLICT DO UPDATE du statut et de l'expiration seulement.
// - Licences déjà en base : statut et expiration mis à jour depuis le fichier, où qu'elles soient dans le fichier
//   (un changement de comté ou de classe n'est pas une disparition).
// - Licence introuvable dans TOUT le fichier : license_status = ABSENT_FROM_FILE et preuve datée au 1er import ;
//   rejet (license_inactive) seulement au 2e import consécutif. Un même fichier ne compte qu'une fois.
// - Statut réellement inactif lu dans le fichier : rejet si l'entreprise n'a jamais été contactée, sinon preuve seule.
// - Licence redevenue active alors que l'entreprise est rejetée : rien n'est rouvert, la liste est affichée.
// - Garde-fous : plus de 20 % de licences disparues, ou plus de 5 % de changements de statut → arrêt, sauf --force.
// - Valeurs du fichier encodées en hexadécimal dans le SQL (sqlLiteral). Aucune écriture dans les tables du CRM.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadLayout, readCsv } from './lib-dbpr.mjs';
import { sqlLiteral as L } from './lib/sql.mjs';

const ABSENT = 'ABSENT_FROM_FILE';
const MAX_ABSENT_RATIO = 0.2;
const MAX_CHANGE_RATIO = 0.05;

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = opt('--file');
const out = opt('--out') ?? '.wrangler/prospection/import-dbpr.sql';
const layoutPath = opt('--layout') ?? 'scripts/prospection/dbpr-layout.json';
const local = args.includes('--local');
const force = args.includes('--force');
if (!file) { console.error('Usage : node scripts/prospection/import-dbpr.mjs --file <fichier DBPR> [--local] [--force]'); process.exit(1); }

const layout = loadLayout(layoutPath);
const d1 = (sql) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', local ? '--local' : '--remote', '--json', '--command', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 * 1024 * 1024 }))[0].results;

const config = Object.fromEntries(d1('SELECT key, value FROM prospect_config').map((r) => [r.key, r.value]));
const classes = new Set(config.target_license_classes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
const counties = new Set(config.target_counties.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
const classTrade = JSON.parse(config.license_class_trade);
const state = config.target_state.toUpperCase();
if (config.license_class_codes_verified !== '1') {
  console.warn('⚠ license_class_codes_verified = 0 : les codes de classe n’ont pas été confirmés dans la table officielle.');
}

const col = layout.columns;
const cell = (row, key) => (col[key] === null ? '' : (row[col[key]] ?? '').trim());
const activeValues = layout.active_status_values.map((v) => v.toUpperCase());
const isActive = (s) => activeValues.includes((s ?? '').toUpperCase());
const countyName = (v) => (layout.county_values === 'code' ? (layout.county_codes?.[v] ?? '') : v).toUpperCase();

const sha = await new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const fileName = basename(file);
const today = new Date().toISOString().slice(0, 10);
const source = `dbpr:${fileName}:${sha.slice(0, 12)}`;

// ── Lecture du fichier : toutes les licences (pour l'absence), et celles du filtre (pour l'insertion).
const inFile = new Map();
const kept = new Map();
const counts = {};
let rows = 0;
let skippedHeader = false;
for await (const row of readCsv(file, layout.file_encoding)) {
  if (layout.has_header_row && !skippedHeader) { skippedHeader = true; continue; }
  rows++;
  const license = cell(row, 'license_number');
  if (!license) continue;
  const status = cell(row, 'status');
  const expiry = cell(row, 'expiry_date') || null;
  if (!inFile.has(license)) inFile.set(license, { status, expiry });

  const cls = cell(row, 'class_code').toUpperCase();
  if (!classes.has(cls) || !isActive(status)) continue;
  const county = countyName(cell(row, 'county'));
  if (!counties.has(county)) continue;
  if (col.state !== null && cell(row, 'state').toUpperCase() !== state) continue;
  const trade = classTrade[cls];
  if (!trade) throw new Error(`Classe ${cls} sans métier dans license_class_trade`);
  if (kept.has(license)) continue;
  kept.set(license, {
    license_number: license, license_class: cls, trade,
    legal_name: cell(row, 'licensee_name') || null, dba_name: cell(row, 'dba_name') || null,
    city: cell(row, 'city') || null, county: titleCase(county), state, license_status: status, license_expiry: expiry,
  });
  const key = `${trade}|${titleCase(county)}`;
  counts[key] = (counts[key] ?? 0) + 1;
}

// ── Comparaison avec la base.
const db = d1('SELECT license_number, license_status, stage, rejected_reason, last_import_sha FROM prospect_companies');
const present = [];
const absent = [];
const changes = [];
const reactivated = [];
for (const c of db) {
  const f = inFile.get(c.license_number);
  if (f) {
    present.push(c.license_number);
    if (f.status !== c.license_status) changes.push(`${c.license_number} : ${c.license_status ?? '∅'} → ${f.status}`);
    if (c.stage === 'rejected' && c.rejected_reason === 'license_inactive' && isActive(f.status)) reactivated.push(c.license_number);
  } else {
    absent.push(c.license_number);
    if (c.license_status !== ABSENT) changes.push(`${c.license_number} : ${c.license_status ?? '∅'} → ${ABSENT}`);
  }
}
const inDb = new Set(db.map((c) => c.license_number));
const newLicenses = [...kept.keys()].filter((l) => !inDb.has(l)).length;

console.log(`${rows} lignes lues, ${inFile.size} licences dans le fichier, ${kept.size} dans le filtre (${newLicenses} nouvelles).`);
console.log(`Base : ${db.length} licences, ${absent.length} absentes du fichier, ${changes.length} changements de statut.`);
printCounts(counts);

const blockers = [];
if (db.length && absent.length / db.length > MAX_ABSENT_RATIO) blockers.push(`${pct(absent.length, db.length)} des licences en base sont absentes du fichier (seuil 20 %)`);
if (db.length && changes.length / db.length > MAX_CHANGE_RATIO) blockers.push(`${pct(changes.length, db.length)} des licences en base changent de statut (seuil 5 %)`);
if (blockers.length) {
  console.log(`\n⛔ ${blockers.join(' ; ')}.`);
  for (const c of changes.slice(0, 100)) console.log(`   ${c}`);
  if (changes.length > 100) console.log(`   … et ${changes.length - 100} autres`);
  if (!force) { console.log('Import arrêté (mauvais fichier ?). Vérifie, puis relance avec --force si c’est voulu.'); process.exit(2); }
  console.log('--force : on continue.');
}
if (reactivated.length) {
  console.log(`\nℹ ${reactivated.length} licence(s) redevenue(s) active(s), entreprise toujours rejetée (non rouverte) : ${reactivated.join(', ')}`);
}

// ── SQL.
const fields = ['license_number', 'license_class', 'trade', 'legal_name', 'dba_name', 'city', 'county', 'state', 'license_status', 'license_expiry'];
const inList = (xs) => xs.map(L).join(', ');
const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const contacted = `EXISTS (SELECT 1 FROM prospect_messages m WHERE m.company_id = prospect_companies.id AND m.direction = 'out' AND m.status IN ('sent', 'bounced', 'replied'))`;
const inactive = `((license_status NOT IN (${inList(activeValues)}) AND license_status <> '${ABSENT}') OR absent_streak >= 2)`;
const open = `stage NOT IN ('rejected', 'suppressed', 'closed')`;

const sql = [
  `INSERT INTO prospect_imports (file_sha256, file_name, rows_read, licenses_in_file, matched, absent, status_changes, forced)
   VALUES (${L(sha)}, ${L(fileName)}, ${rows}, ${inFile.size}, ${kept.size}, ${absent.length}, ${changes.length}, ${force && blockers.length ? 1 : 0})
   ON CONFLICT (file_sha256) DO NOTHING;`,
];
for (const c of chunks([...kept.values()], 50)) {
  sql.push(`INSERT INTO prospect_companies (${fields.join(', ')}) VALUES\n${c.map((v) => `(${fields.map((f) => L(v[f])).join(', ')})`).join(',\n')}
ON CONFLICT (license_number) DO UPDATE SET license_status = excluded.license_status, license_expiry = excluded.license_expiry, updated_at = datetime('now');`);
}
// Licences en base retrouvées dans le fichier : vrai statut, compteur d'absence remis à zéro.
for (const c of chunks(present, 50)) {
  sql.push(...c.map((l) => `UPDATE prospect_companies SET license_status = ${L(inFile.get(l).status)}, license_expiry = ${L(inFile.get(l).expiry)},
  absent_streak = 0, last_import_sha = ${L(sha)}, updated_at = datetime('now') WHERE license_number = ${L(l)};`));
}
// Licences introuvables dans tout le fichier : +1 seulement si ce fichier n'a pas déjà été compté.
for (const c of chunks(absent, 200)) {
  sql.push(`UPDATE prospect_companies SET license_status = '${ABSENT}', absent_streak = absent_streak + 1, last_import_sha = ${L(sha)}, updated_at = datetime('now')
  WHERE license_number IN (${inList(c)}) AND COALESCE(last_import_sha, '') <> ${L(sha)};`);
  sql.push(`INSERT INTO prospect_evidence (company_id, signal, value, source_url)
  SELECT id, 'license_absent_from_file', ${L(today)}, ${L(source)} FROM prospect_companies WHERE license_number IN (${inList(c)})
  ON CONFLICT (company_id, signal, source_url) DO NOTHING;`);
}
// Règles (idempotentes, sur toute la table) : rejet si jamais contacté, preuve seule sinon.
sql.push(`UPDATE prospect_companies SET stage = 'rejected', rejected_reason = 'license_inactive', updated_at = datetime('now')
  WHERE ${inactive} AND ${open} AND NOT ${contacted};`);
sql.push(`INSERT INTO prospect_evidence (company_id, signal, value, source_url)
  SELECT id, 'license_inactive', license_status, ${L(source)} FROM prospect_companies WHERE ${inactive} AND ${contacted}
  ON CONFLICT (company_id, signal, source_url) DO NOTHING;`);

mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(out, sql.join('\n') + '\n');
writeFileSync(out.replace(/\.sql$/, '.counts.json'), JSON.stringify(counts, null, 2));
console.log(`\nSQL → ${out} (${sql.length} requêtes). Comptage indépendant : python3 scripts/prospection/count-dbpr.py --file ${file}${local ? ' --local' : ''}`);

function pct(a, b) { return `${((a / b) * 100).toFixed(1)} %`; }
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
