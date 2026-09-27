// Assemble toutes les migrations en un seul SQL à coller dans la console D1 du tableau de bord Cloudflare.
// Il enregistre aussi chaque migration dans d1_migrations (même schéma que wrangler), pour que
// `wrangler d1 migrations apply --remote` ne tente pas de les rejouer plus tard.
// Usage : npm run build:d1-setup  →  deploy/d1-setup.sql
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const files = readdirSync('migrations').filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const out = [
  '-- GÉNÉRÉ par scripts/build-d1-setup.mjs — ne pas modifier à la main.',
  '-- À exécuter UNE SEULE FOIS sur une base D1 vide (console D1 du tableau de bord Cloudflare).',
  '-- Ne contient aucune donnée de démonstration.',
  '',
  `CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`,
];
for (const f of files) {
  out.push('', `-- ── ${f} ${'─'.repeat(Math.max(0, 60 - f.length))}`, readFileSync(`migrations/${f}`, 'utf8').trim());
  out.push(`INSERT INTO d1_migrations (name) VALUES (${q(f)});`);
}
writeFileSync('deploy/d1-setup.sql', out.join('\n') + '\n');
console.log(`deploy/d1-setup.sql : ${files.length} migrations (${files.join(', ')})`);
