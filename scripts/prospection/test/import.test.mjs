// Tests de l'import DBPR sur la base LOCALE uniquement (gabarit et fichiers fictifs, pas le vrai format).
// Lancement : node --test scripts/prospection/test/import.test.mjs
// Vide les tables prospect_* de la base locale avant chaque scénario ; ne touche à aucune table du CRM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const DIR = '.wrangler/test-import';
mkdirSync(DIR, { recursive: true });
const layout = `${DIR}/layout.json`;
writeFileSync(layout, JSON.stringify({
  _doc_url: 'TEST — gabarit fictif', file_name: 'x', has_header_row: false, file_encoding: 'utf8',
  columns: { license_number: 0, class_code: 1, licensee_name: 2, dba_name: 3, city: 4, county: 5, state: 6, status: 7, expiry_date: 8 },
  active_status_values: ['A'], county_values: 'name', county_codes: null,
}));

const d1 = (sql) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', '--local', '--json', '--command', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).map((r) => r.results);
const reset = () => d1(`DELETE FROM prospect_messages; DELETE FROM prospect_evidence; DELETE FROM prospect_jobs; DELETE FROM prospect_contacts;
  DELETE FROM prospect_qualifications; DELETE FROM prospect_companies; DELETE FROM prospect_imports; DELETE FROM prospect_log`);

let n = 0;
/** Écrit un fichier DBPR fictif, lance l'import, applique le SQL. Renvoie la sortie et le code de sortie. */
function importFile(lines, extra = []) {
  const file = `${DIR}/f${++n}.csv`;
  writeFileSync(file, lines.map((l) => l.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n') + '\n');
  const sqlOut = `${DIR}/f${n}.sql`;
  let out = '', code = 0;
  try {
    out = execFileSync('node', ['scripts/prospection/import-dbpr.mjs', '--file', file, '--layout', layout, '--out', sqlOut, '--local', ...extra],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { out = String(e.stdout); code = e.status; }
  if (code === 0) execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', '--local', `--file=${sqlOut}`], { stdio: 'ignore' });
  return { out, code, sqlOut };
}
const row = (lic, { cls = 'CAC', county = 'HILLSBOROUGH', status = 'A', name = 'ACME AIR' } = {}) => [lic, cls, name, '', 'TAMPA', county, 'FL', status, '2027-08-31'];
const company = (lic) => d1(`SELECT stage, rejected_reason, license_status, absent_streak FROM prospect_companies WHERE license_number = '${lic}'`)[0][0];
const evidence = (lic, signal) => d1(`SELECT count(*) n FROM prospect_evidence e JOIN prospect_companies c ON c.id = e.company_id WHERE c.license_number = '${lic}' AND e.signal = '${signal}'`)[0][0].n;
// 40 licences stables pour rester sous les garde-fous (1 changement = 2,5 %).
const stable = Array.from({ length: 40 }, (_, i) => row(`CAC9${String(i).padStart(3, '0')}`));

test('upsert : relancer ne crée aucun doublon, nom inchangé, statut mis à jour', () => {
  reset();
  importFile([...stable, row('CAC1')]);
  importFile([...stable, row('CAC1', { name: 'AUTRE NOM' })]);
  assert.equal(d1(`SELECT count(*) n FROM prospect_companies`)[0][0].n, 41);
  assert.equal(d1(`SELECT legal_name FROM prospect_companies WHERE license_number = 'CAC1'`)[0][0].legal_name, 'ACME AIR');
});

test('statut inactif dans le fichier : rejet si jamais contacté, preuve seule si déjà contacté', () => {
  reset();
  importFile([...stable, row('CAC1'), row('CAC2')]);
  d1(`INSERT INTO prospect_messages (company_id, direction, status, sent_at) SELECT id, 'out', 'sent', datetime('now') FROM prospect_companies WHERE license_number = 'CAC2'`);
  d1(`UPDATE prospect_companies SET stage = 'sent' WHERE license_number = 'CAC2'`);
  importFile([...stable, row('CAC1', { status: 'S' }), row('CAC2', { status: 'S' })]);
  assert.deepEqual(company('CAC1'), { stage: 'rejected', rejected_reason: 'license_inactive', license_status: 'S', absent_streak: 0 });
  assert.equal(company('CAC2').stage, 'sent');
  assert.equal(evidence('CAC2', 'license_inactive'), 1);
});

test('absence : pas de rejet au 1er import, rejet au 2e consécutif ; même fichier compté une fois', () => {
  reset();
  importFile([...stable, row('CAC1')]);
  const first = importFile([...stable]);
  assert.deepEqual(company('CAC1'), { stage: 'discovered', rejected_reason: null, license_status: 'ABSENT_FROM_FILE', absent_streak: 1 });
  assert.equal(evidence('CAC1', 'license_absent_from_file'), 1);
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', '--local', `--file=${first.sqlOut}`], { stdio: 'ignore' });
  assert.equal(company('CAC1').absent_streak, 1, 'réappliquer le même SQL ne compte pas un 2e import');
  importFile([...stable, row('CAC9999', { name: 'X' })]); // un autre fichier, toujours sans CAC1
  assert.deepEqual(company('CAC1'), { stage: 'rejected', rejected_reason: 'license_inactive', license_status: 'ABSENT_FROM_FILE', absent_streak: 2 });
});

test('absence puis réapparition : compteur remis à zéro, vrai statut restauré, pas de rejet', () => {
  reset();
  importFile([...stable, row('CAC1')]);
  importFile([...stable]);
  importFile([...stable, row('CAC1')]);
  assert.deepEqual(company('CAC1'), { stage: 'discovered', rejected_reason: null, license_status: 'A', absent_streak: 0 });
});

test('changement de comté (hors filtre) : pas une disparition', () => {
  reset();
  importFile([...stable, row('CAC1')]);
  importFile([...stable, row('CAC1', { county: 'MIAMI-DADE' })]);
  assert.deepEqual(company('CAC1'), { stage: 'discovered', rejected_reason: null, license_status: 'A', absent_streak: 0 });
});

test('licence redevenue active : reste rejetée, numéro affiché', () => {
  reset();
  importFile([...stable, row('CAC1')]);
  importFile([...stable, row('CAC1', { status: 'S' })]);
  const r = importFile([...stable, row('CAC1')]);
  assert.equal(company('CAC1').stage, 'rejected');
  assert.match(r.out, /redevenue\(s\) active\(s\).*CAC1/);
});

test('garde-fous : > 20 % disparues ou > 5 % de changements → arrêt sans --force', () => {
  reset();
  importFile([...stable, row('CAC1')]);
  const gone = importFile(stable.slice(0, 20));
  assert.equal(gone.code, 2);
  assert.match(gone.out, /absentes du fichier \(seuil 20 %\)/);
  const changed = importFile([...stable.slice(0, 37), ...stable.slice(37).map((r) => [...r.slice(0, 7), 'S', r[8]]), row('CAC1')]);
  assert.equal(changed.code, 2);
  assert.match(changed.out, /changent de statut \(seuil 5 %\)/);
  assert.equal(importFile(stable.slice(0, 20), ['--force']).code, 0);
});

test('valeurs hostiles du fichier stockées telles quelles, table intacte', () => {
  reset();
  const evil = "'); DROP TABLE prospect_companies; --";
  importFile([...stable, row('CAC1', { name: evil }), row('CAC2', { name: 'Ünïcødé ✓ ; -- \' "' })]);
  assert.equal(d1(`SELECT legal_name FROM prospect_companies WHERE license_number = 'CAC1'`)[0][0].legal_name, evil);
  assert.equal(d1(`SELECT legal_name FROM prospect_companies WHERE license_number = 'CAC2'`)[0][0].legal_name, 'Ünïcødé ✓ ; -- \' "');
  reset();
});
