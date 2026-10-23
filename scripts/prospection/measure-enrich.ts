// Mesure, sur de vrais sites, le crawl poli et le temps de calcul (CPU) de l'extraction.
// À lancer sur l'ordinateur de Mathys (l'environnement de Claude n'a pas accès au web) :
//   npm run prospect:measure -- https://site1.com https://site2.com ...   (5 sites)
//   option --local : lit prospect_config dans la base locale au lieu de la base distante.
// Rien n'est écrit en base. Les emails ne sont ni affichés ni stockés.
//
// Limite de la mesure : c'est le CPU de Node (même moteur V8 que Workers, mais pas le même runtime).
// Dans un Worker, le chronomètre ne peut pas mesurer le CPU ; la valeur qui fait foi est celle du
// tableau de bord Cloudflare (Workers → Metrics → CPU time) une fois le Worker déployé.
import { execFileSync } from 'node:child_process';
import { crawlSite } from '../../workers/prospection/src/enrich/crawl';
import { extractSignals } from '../../workers/prospection/src/enrich/extract';
import { parseRobots } from '../../workers/prospection/src/enrich/robots';
import { loadConfig } from '../../workers/prospection/src/lib/config';

const args = process.argv.slice(2);
const local = args.includes('--local');
const urls = args.filter((a) => /^https?:\/\//.test(a));
if (!urls.length) { console.error('Usage : npm run prospect:measure -- [--local] https://site1.com ...'); process.exit(1); }

const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', 'crm-sda', local ? '--local' : '--remote', '--json',
  '--command', 'SELECT key, value FROM prospect_config'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const rows = JSON.parse(raw)[0].results as { key: string; value: string }[];
const fakeDb = { prepare: () => ({ all: async () => ({ results: rows }) }) };
const cfg = await loadConfig({ DB: fakeDb } as never);

const cpuMs = (fn: () => void, runs = 20) => {
  fn(); // échauffement
  const t = process.cpuUsage();
  for (let i = 0; i < runs; i++) fn();
  const d = process.cpuUsage(t);
  return (d.user + d.system) / 1000 / runs;
};

const summary: { url: string; pages: number; kb: number; cpu: number }[] = [];
for (const url of urls) {
  console.log(`\n── ${url}`);
  const started = Date.now();
  const crawl = await crawlSite(url, {
    userAgent: cfg.crawlUserAgent, delayMs: cfg.crawlDelayMs, maxPages: cfg.crawlMaxPages,
    timeoutMs: cfg.crawlTimeoutMs, maxBytes: cfg.crawlMaxBytes, pagePatterns: cfg.crawlPagePatterns,
  });
  console.log(`  ${crawl.requests} requêtes, ${crawl.pages.length} pages lues en ${((Date.now() - started) / 1000).toFixed(1)} s (attentes comprises)`);
  for (const s of crawl.skipped) console.log(`  ignorée : ${s.url} (${s.reason})`);
  if (!crawl.pages.length) { summary.push({ url, pages: 0, kb: 0, cpu: 0 }); continue; }

  const bytes = crawl.pages.map((p) => Buffer.from(p.html));
  const kb = bytes.reduce((n, b) => n + b.length, 0) / 1000;
  const decode = cpuMs(() => { for (const b of bytes) new TextDecoder().decode(b); });
  const robots = cpuMs(() => parseRobots('User-agent: *\nDisallow: /wp-admin/', cfg.crawlUserAgent));
  const extract = cpuMs(() => extractSignals(crawl.pages, cfg));
  const total = decode + robots + extract;
  console.log(`  ${kb.toFixed(0)} ko de HTML · CPU : décodage ${decode.toFixed(2)} ms + extraction ${extract.toFixed(2)} ms = ${total.toFixed(2)} ms par entreprise`);
  for (const e of extractSignals(crawl.pages, cfg)) console.log(`  ${e.signal.padEnd(28)} ${String(e.value).padEnd(22)} ${e.source_url}`);
  summary.push({ url, pages: crawl.pages.length, kb, cpu: total });
}

console.log('\n── Résumé (limite du plan gratuit : 10 ms de CPU par invocation)');
for (const s of summary) console.log(`  ${s.cpu.toFixed(2).padStart(7)} ms  ${String(s.pages).padStart(2)} pages  ${s.kb.toFixed(0).padStart(5)} ko  ${s.url}`);
const max = Math.max(...summary.map((s) => s.cpu));
console.log(max > 10 ? `  ⚠ au moins un site dépasse 10 ms (max ${max.toFixed(2)} ms)` : `  max ${max.toFixed(2)} ms : sous la limite (hors coût des appels D1 et de l'exécution du Worker lui-même)`);
console.log('  File d\'attente : 1 message par entreprise = 3 opérations (écriture, lecture, suppression), +1 lecture par nouvel essai.');
