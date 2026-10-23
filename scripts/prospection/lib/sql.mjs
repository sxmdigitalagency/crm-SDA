// Littéraux SQLite pour le SQL généré hors Worker (scripts locaux → wrangler d1 execute).
// Toute chaîne est encodée en hexadécimal UTF-8 puis convertie en texte : CAST(X'…' AS TEXT).
// Aucun caractère de la chaîne n'apparaît dans le SQL, quel que soit son contenu (site web, recherche, DBPR).
// Dans le Worker, on utilise les vrais paramètres liés de D1 ; ce module ne sert qu'aux scripts.

export const MAX_STRING = 2000;

/** Littéral SQL d'une valeur : NULL, entier/réel fini, booléen (0/1) ou chaîne hexadécimale. */
export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Valeur numérique refusée : ${value}`);
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'string') throw new Error(`Type refusé pour SQL : ${typeof value}`);
  const clean = capString(value.replace(/\u0000/g, ''), MAX_STRING);
  if (clean === '') return "''";
  return `CAST(X'${Buffer.from(clean, 'utf8').toString('hex')}' AS TEXT)`;
}

/** Coupe une chaîne à `max` caractères sans casser un caractère Unicode (paire de substitution). */
export function capString(s, max) {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

/** Remplace les `?` hors chaînes SQL par les littéraux des paramètres, dans l'ordre. */
export function renderSql(sql, params) {
  let out = '';
  let i = 0;
  let inString = false;
  for (const ch of sql) {
    if (ch === "'") inString = !inString;
    if (ch === '?' && !inString) {
      if (i >= params.length) throw new Error(`Paramètre manquant (${i + 1}) dans : ${sql.slice(0, 80)}`);
      out += sqlLiteral(params[i++]);
    } else out += ch;
  }
  if (i !== params.length) throw new Error(`${params.length} paramètres pour ${i} emplacements dans : ${sql.slice(0, 80)}`);
  return out;
}
