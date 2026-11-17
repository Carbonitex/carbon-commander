#!/usr/bin/env node
/** `npm version` hook: copy package.json's version into src/manifest.json. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifestPath = path.join(root, 'src/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
// Chrome versions are 1-4 dot-separated integers: drop any pre-release suffix.
manifest.version = String(pkg.version).split('-')[0];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`src/manifest.json version -> ${manifest.version}`);
