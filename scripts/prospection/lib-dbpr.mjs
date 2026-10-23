// Partagé par import-dbpr.mjs : lecture du fichier DBPR et du gabarit de colonnes.
import { createReadStream, readFileSync } from 'node:fs';

/** Gabarit validé : refuse de continuer si une colonne n'a pas été renseignée depuis la doc officielle. */
export function loadLayout(path) {
  const layout = JSON.parse(readFileSync(path, 'utf8'));
  const missing = Object.entries(layout.columns).filter(([k, v]) => v === null && !['dba_name', 'expiry_date', 'state'].includes(k)).map(([k]) => k);
  if (!layout._doc_url) missing.push('_doc_url');
  if (layout.has_header_row === null) missing.push('has_header_row');
  if (!Array.isArray(layout.active_status_values)) missing.push('active_status_values');
  if (missing.length) {
    throw new Error(`Gabarit DBPR incomplet (${path}) : ${missing.join(', ')}.\n` +
      `Ces valeurs doivent venir de la documentation officielle du format, pas d'une supposition.`);
  }
  return layout;
}

/** Lecteur CSV « guillemets / virgules » (format annoncé par le readme DBPR), ligne logique par ligne logique. */
export async function* readCsv(path) {
  let field = '';
  let row = [];
  let inQuotes = false;
  let pendingQuote = false;
  const stream = createReadStream(path, { encoding: 'latin1' });
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (pendingQuote) {
        pendingQuote = false;
        if (ch === '"') { field += '"'; continue; }
        inQuotes = false;
      }
      if (inQuotes) {
        if (ch === '"') pendingQuote = true; else field += ch;
        continue;
      }
      if (ch === '"' && field === '') { inQuotes = true; continue; }
      if (ch === ',') { row.push(field); field = ''; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && chunk[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') yield row;
        row = [];
        continue;
      }
      field += ch;
    }
  }
  if (pendingQuote) inQuotes = false;
  if (field !== '' || row.length) { row.push(field); yield row; }
}
