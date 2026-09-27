// Assemble toutes les migrations en un seul SQL à coller dans la console D1 du tableau de bord Cloudflare.
// Il enregistre aussi chaque migration dans d1_migrations (même schéma que wrangler), pour que
// `wrangler d1 migrations apply --remote` ne tente pas de les rejouer plus tard.
// Usage : npm run build:d1-setup  →  deploy/d1-setup.sql
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const files = readdirSync('migrations').filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
const q = (s) => `'${s.replace(/'/g, "''")}'`;
// La console D1 du tableau de bord aplatit le texte collé sur UNE ligne : un seul commentaire `--`
// y neutraliserait tout le reste. On retire donc tous les commentaires (hors chaînes SQL).
function stripComments(sql) {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inString = !inString; // '' (apostrophe échappée) bascule deux fois : état inchangé
    if (!inString && ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).join('\n');
}

const out = [
  `CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`,
];
for (const f of files) {
  out.push(stripComments(readFileSync(`migrations/${f}`, 'utf8')));
  out.push(`INSERT INTO d1_migrations (name) VALUES (${q(f)});`);
}
writeFileSync('deploy/d1-setup.sql', out.join('\n') + '\n');
console.log(`deploy/d1-setup.sql : ${files.length} migrations (${files.join(', ')})`);
