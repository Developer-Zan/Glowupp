import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const assets = [
  'index.html',
  'favicon.png',
  'Upp.svg',
  'Posnetek zaslona 2026–07–14 ob 11.17.14.png',
  'Posnetek zaslona 2026–07–14 ob 11.17.35.png',
  'Posnetek zaslona 2026–07–14 ob 11.17.43.png'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(assets.map(asset => copyFile(resolve(root, asset), resolve(output, asset))));
console.log(`Built ${assets.length} public assets in dist/`);
