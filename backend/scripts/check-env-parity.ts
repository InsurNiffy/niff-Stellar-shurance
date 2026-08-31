#!/usr/bin/env ts-node
/**
 * backend/scripts/check-env-parity.ts
 *
 * Detects configuration drift between two deployment environments by
 * diffing the *set of keys* in two env files (values are never compared
 * or printed, since they may contain secrets).
 *
 * Usage:
 *   npx ts-node scripts/check-env-parity.ts <envFileA> <envFileB>
 *
 * Exits 1 if either file has keys the other is missing.
 */

import { existsSync, readFileSync } from 'fs';

function parseEnvKeys(filePath: string): Set<string> {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const keys = new Set<string>();
  for (const raw of readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    keys.add(line.slice(0, eq).trim());
  }
  return keys;
}

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('Usage: ts-node scripts/check-env-parity.ts <envFileA> <envFileB>');
  process.exit(1);
}

const keysA = parseEnvKeys(fileA);
const keysB = parseEnvKeys(fileB);

const onlyInA = [...keysA].filter((k) => !keysB.has(k)).sort();
const onlyInB = [...keysB].filter((k) => !keysA.has(k)).sort();

if (onlyInA.length === 0 && onlyInB.length === 0) {
  console.log(`✅  No config drift: ${fileA} and ${fileB} define the same keys.`);
  process.exit(0);
}

console.error(`❌  Config drift detected between ${fileA} and ${fileB}`);
if (onlyInA.length > 0) {
  console.error(`  Only in ${fileA}:`);
  onlyInA.forEach((k) => console.error(`    - ${k}`));
}
if (onlyInB.length > 0) {
  console.error(`  Only in ${fileB}:`);
  onlyInB.forEach((k) => console.error(`    - ${k}`));
}
process.exit(1);
