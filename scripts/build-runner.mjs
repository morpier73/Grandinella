// Crea public/runners/background.js unendo hail.js (senza export) e runner.js.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const hail = readFileSync(new URL('src/hail.js', root), 'utf8').replace(/^export /gm, '');
const runner = readFileSync(new URL('src/runner.js', root), 'utf8');

mkdirSync(new URL('public/runners/', root), { recursive: true });
writeFileSync(
  new URL('public/runners/background.js', root),
  '// File generato da scripts/build-runner.mjs: non modificarlo a mano.\n' + hail + '\n' + runner
);
console.log('Runner scritto in public/runners/background.js');
