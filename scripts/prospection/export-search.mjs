// Mesure d'efficacité du moteur : N entreprises recherchées tirées au hasard (acceptées, à revoir
// et sans site), avec l'URL retenue et la raison. Colonnes « correct » et « commentaire » à remplir.
// Usage : node scripts/prospection/export-search.mjs [--n 30] [--local] [--out …]
// Lecture seule. Données d'entreprises : ne pas committer le fichier produit.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const n = Number(opt('--n', '30'));
const out = opt('--out', '.wrangler/prospection/controle-recherche.csv');
const local = args.includes('--local');
if (!Number.isInteger(n) || n < 1) { console.error('--n doit être un entier positif'); process.exit(1); }

const sql = `SELECT c.id, c.license_number, c.trade, c.legal_name, c.dba_name, c.city, c.county,
       c.website_status, c.website_url, c.website_match_reason, c.stage, c.rejected_reason
  FROM prospect_companies c
 WHERE EXISTS (SELECT 1 FROM prospect_jobs j WHERE j.worker = 'enrich' AND j.idem_key = 'search:' || c.id AND j.status = 'done')
 ORDER BY random() LIMIT ${n}`;
const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', local ? '--local' : '--remote', '--json', '--command', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
const rows = JSON.parse(raw)[0].results;

const cols = ['id', 'license_number', 'trade', 'legal_name', 'dba_name', 'city', 'county', 'website_status', 'website_url', 'website_match_reason', 'stage', 'rejected_reason'];
const csv = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const lines = [[...cols, 'site correct (oui/non/pas de site)', 'commentaire'].join(',')];
for (const r of rows) lines.push([...cols.map((c) => csv(r[c])), '', ''].join(','));
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(out, '﻿' + lines.join('\n') + '\n');
const by = rows.reduce((m, r) => ({ ...m, [r.website_status]: (m[r.website_status] ?? 0) + 1 }), {});
console.log(`${rows.length} entreprises → ${out}`, by);
