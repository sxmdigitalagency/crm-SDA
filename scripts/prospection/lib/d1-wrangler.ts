// Adaptateur D1 minimal pour les scripts locaux : même interface que la liaison D1 du Worker
// (prepare / bind / first / all / run / batch), exécuté par `wrangler d1 execute --json --command`
// avec les identifiants de l'utilisateur. Les valeurs passent par sqlLiteral (hexadécimal), jamais en clair.
import { execFileSync } from 'node:child_process';
import { renderSql } from './sql.mjs';

const MAX_COMMAND = 90_000; // sous la limite d'un argument de ligne de commande (128 ko sous Linux)

interface Result { results: unknown[]; success: boolean; meta: Record<string, unknown> }

export function wranglerD1(database: string, target: 'local' | 'remote') {
  const exec = (statements: string[]): Result[] => {
    const out: Result[] = [];
    // Plusieurs requêtes par appel, découpées si la commande devient trop longue.
    let chunk: string[] = [];
    let size = 0;
    const flush = () => {
      if (!chunk.length) return;
      const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', database, `--${target}`, '--json', '--command', chunk.join(';\n')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
      const parsed = JSON.parse(raw) as Result[];
      if (parsed.length !== chunk.length) throw new Error(`wrangler a renvoyé ${parsed.length} résultats pour ${chunk.length} requêtes`);
      out.push(...parsed);
      chunk = []; size = 0;
    };
    for (const s of statements) {
      if (s.length > MAX_COMMAND) throw new Error(`Requête trop longue (${s.length} caractères)`);
      if (size + s.length > MAX_COMMAND) flush();
      chunk.push(s); size += s.length + 2;
    }
    flush();
    return out;
  };

  class Statement {
    constructor(readonly sql: string, readonly params: unknown[] = []) {}
    bind(...params: unknown[]) { return new Statement(this.sql, params); }
    render() { return renderSql(this.sql.trim().replace(/;\s*$/, ''), this.params); }
    async all<T = Record<string, unknown>>() { return { results: exec([this.render()])[0]!.results as T[], success: true, meta: {} }; }
    async first<T = Record<string, unknown>>() { return ((await this.all<T>()).results[0] ?? null) as T | null; }
    async run() { return this.all(); }
  }

  return {
    prepare: (sql: string) => new Statement(sql),
    /** Exécute dans l'ordre. Pas de transaction garantie : l'idempotence repose sur l'ordre des écritures. */
    async batch(statements: Statement[]) {
      return exec(statements.map((s) => s.render())).map((r) => ({ results: r.results, success: true, meta: {} }));
    },
  } as unknown as D1Database;
}
