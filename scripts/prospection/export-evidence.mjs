// Export de contrôle (spec 4.2.5) : N entreprises enrichies tirées au hasard, une ligne par preuve,
// avec son source_url, pour vérification à la main. Colonnes « correct » et « commentaire » à remplir.
// Usage : node scripts/prospection/export-evidence.mjs [--n 30] [--local] [--out controle-enrich.csv]
// Lecture seule. Le fichier contient des données d'entreprises : ne pas le committer.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const n = Number(opt('--n', '30'));
const out = opt('--out', '.wrangler/prospection/controle-enrich.csv');
const local = args.includes('--local');
if (!Number.isInteger(n) || n < 1) { console.error('--n doit être un entier positif'); process.exit(1); }

const sql = `WITH sample AS (
  SELECT id FROM prospect_companies WHERE stage = 'enriched' ORDER BY random() LIMIT ${n}
)
SELECT c.id, c.license_number, c.trade, COALESCE(c.dba_name, c.legal_name) AS name, c.city, c.county, c.website_url,
       e.signal, e.value, e.source_url, e.excerpt, e.captured_at
  FROM sample s JOIN prospect_companies c ON c.id = s.id
  JOIN prospect_evidence e ON e.company_id = c.id
 ORDER BY c.id, e.signal`;
const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', local ? '--local' : '--remote', '--json', '--command', sql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
const rows = JSON.parse(raw)[0].results;

const cols = ['id', 'license_number', 'trade', 'name', 'city', 'county', 'website_url', 'signal', 'value', 'source_url', 'excerpt', 'captured_at'];
const csv = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const lines = [[...cols, 'correct (oui/non)', 'commentaire'].join(',')];
for (const r of rows) lines.push([...cols.map((c) => csv(r[c])), '', ''].join(','));
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(out, '\uFEFF' + lines.join('\n') + '\n'); // BOM : accents corrects à l'ouverture dans Excel / Numbers
const companies = new Set(rows.map((r) => r.id)).size;
console.log(`${companies} entreprises, ${rows.length} preuves → ${out}`);
if (companies < n) console.log(`(seulement ${companies} entreprises enrichies disponibles)`);
