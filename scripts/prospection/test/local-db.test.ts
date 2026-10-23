// Tests sur la base LOCALE : adaptateur wrangler (encodage hexadécimal), sélection enrich, vocabulaire fermé.
// Lancement : npm run prospect:test:db  (vide les tables prospect_* locales ; aucune table du CRM touchée)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wranglerD1 } from '../lib/d1-wrangler';
import { sqlLiteral } from '../lib/sql.mjs';
import { claimEnrichJobs, runEnrich } from '../../../workers/prospection/src/enrich/index';
import type { Env } from '../../../workers/prospection/src/env';

const DB = wranglerD1('crm-sda', 'local');
const env = { DB, LLM_MODEL: '' } as unknown as Env;
const reset = () => DB.batch(['prospect_evidence', 'prospect_jobs', 'prospect_log', 'prospect_companies'].map((t) => DB.prepare(`DELETE FROM ${t}`)));

test('sqlLiteral : aucune chaîne en clair dans le SQL', () => {
  const lit = sqlLiteral("'); DROP TABLE x; --");
  assert.match(lit, /^CAST\(X'[0-9a-f]+' AS TEXT\)$/);
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(42), '42');
  assert.throws(() => sqlLiteral(Number.NaN));
  assert.throws(() => sqlLiteral(Infinity));
  assert.throws(() => sqlLiteral({}));
});

test('adaptateur : valeurs hostiles stockées telles quelles, table intacte', async () => {
  await reset();
  const values = ["'); DROP TABLE prospect_companies; --", "O'Brien ; -- commentaire", 'a\u0000b', 'Ünïcødé ✓ 🌴 « » \\ "', '?', "x'||'y"];
  for (const [i, v] of values.entries()) {
    await DB.prepare(`INSERT INTO prospect_companies (license_number, license_class, trade, legal_name) VALUES (?, 'CAC', 'hvac', ?)`).bind(`T${i}`, v).run();
  }
  const { results } = await DB.prepare(`SELECT license_number, legal_name FROM prospect_companies ORDER BY license_number`).all<{ license_number: string; legal_name: string }>();
  assert.deepEqual(results.map((r) => r.legal_name), values.map((v) => v.replace(/\u0000/g, '')));
  const t = await DB.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'prospect_companies'`).first<{ n: number }>();
  assert.equal(t!.n, 1);
});

test('plafond : chaîne de 5 000 caractères coupée à 2 000', async () => {
  await reset();
  await DB.prepare(`INSERT INTO prospect_companies (license_number, license_class, trade, legal_name) VALUES ('L', 'CAC', 'hvac', ?)`).bind('é'.repeat(5000)).run();
  const r = await DB.prepare(`SELECT length(legal_name) AS n FROM prospect_companies`).first<{ n: number }>();
  assert.equal(r!.n, 2000);
});

test('enrich : une entreprise « review » n’est jamais sélectionnée, une « accepted » l’est', async () => {
  await reset();
  await DB.batch([
    DB.prepare(`INSERT INTO prospect_companies (license_number, license_class, trade, website_url, website_status) VALUES ('A1', 'CAC', 'hvac', 'https://a.example/', 'accepted')`),
    DB.prepare(`INSERT INTO prospect_companies (license_number, license_class, trade, website_url, website_status) VALUES ('R1', 'CAC', 'hvac', 'https://r.example/', 'review')`),
    DB.prepare(`INSERT INTO prospect_companies (license_number, license_class, trade, website_url, website_status) VALUES ('N1', 'CAC', 'hvac', NULL, 'none')`),
  ]);
  const jobs = await claimEnrichJobs(env, 25, { resume: true });
  const ids = (await DB.prepare(`SELECT id, license_number FROM prospect_companies`).all<{ id: number; license_number: string }>()).results;
  const lic = (id: number) => ids.find((r) => r.id === id)!.license_number;
  assert.deepEqual(jobs.map((j) => lic(j.company_id)), ['A1']);
  // Reprise : relancer reprend le même job (interrompu), sans en créer un second.
  const again = await claimEnrichJobs(env, 25, { resume: true });
  assert.deepEqual(again.map((j) => j.id), jobs.map((j) => j.id));
  assert.equal((await DB.prepare(`SELECT count(*) AS n FROM prospect_jobs`).first<{ n: number }>())!.n, 1);
  // runEnrich refuse un site non accepté, même si on lui passe le job à la main.
  await DB.prepare(`INSERT INTO prospect_jobs (worker, idem_key, company_id) SELECT 'enrich', 'company:' || id, id FROM prospect_companies WHERE license_number = 'R1'`).run();
  const r = await DB.prepare(`SELECT j.id, j.company_id FROM prospect_jobs j JOIN prospect_companies c ON c.id = j.company_id WHERE c.license_number = 'R1'`).first<{ id: number; company_id: number }>();
  await assert.rejects(runEnrich(env, r!.id, r!.company_id), /site non accepté/);
  await reset();
});
