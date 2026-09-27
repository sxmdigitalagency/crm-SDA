// Génère public/js/icons.js à partir de lucide-static (licence ISC) — seulement les icônes utilisées.
import { readFileSync, writeFileSync } from 'node:fs';

const NAMES = [
  'layout-dashboard', 'users', 'file-text', 'receipt', 'package', 'settings', 'log-out', 'plus', 'search',
  'sun', 'moon', 'monitor', 'trash-2', 'download', 'eye', 'send', 'check', 'x', 'arrow-up-right', 'arrow-down-right',
  'arrow-left', 'arrow-right', 'copy', 'grip-vertical', 'circle-alert', 'clock', 'wallet', 'user-plus', 'file-check',
  'banknote', 'pencil', 'mail', 'phone', 'building-2', 'user', 'chevron-down', 'minus', 'repeat', 'ban', 'inbox', 'loader-circle',
];
const out = {};
for (const n of NAMES) {
  const svg = readFileSync(`node_modules/lucide-static/icons/${n}.svg`, 'utf8');
  out[n] = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
}
writeFileSync('public/js/icons.js', `// Généré par scripts/build-icons.mjs — icônes Lucide (ISC, https://lucide.dev)
const PATHS = ${JSON.stringify(out, null, 0)};

export function icon(name, { size = 18, label } = {}) {
  const a11y = label ? \`role="img" aria-label="\${label}"\` : 'aria-hidden="true"';
  return \`<svg class="icon" width="\${size}" height="\${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" \${a11y}>\${PATHS[name] ?? ''}</svg>\`;
}
`);
console.log(`${NAMES.length} icônes`);
