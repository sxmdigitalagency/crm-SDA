// Compile un point d'entrée TypeScript (qui importe le code du Worker, sans copie) puis l'exécute.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

export async function launch(entry, name) {
  const outfile = `.wrangler/build/${name}.mjs`;
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning', target: 'node20' });
  await import(pathToFileURL(outfile).href);
}
