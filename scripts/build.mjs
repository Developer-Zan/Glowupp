import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const assets = [
  'index.html',
  'favicon.png',
  'Upp.svg',
  'upp-welcome.png',
  'upp-home.png',
  'upp-active-run.png',
  'upp-workout-path.png',
  'upp-log-meal.png'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(assets.map(asset => copyFile(resolve(root, asset), resolve(output, asset))));
console.log(`Built ${assets.length} public assets in dist/`);
