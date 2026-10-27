#!/usr/bin/env ts-node
/**
 * CI check (#1637): fails if a flag in ALLOWED_FLAG_KEYS has been marked
 * `deprecated` for more than one release cycle (minor version).
 *
 * Run: ts-node scripts/check-deprecated-flags.ts
 */

import { DEPRECATED_FLAGS } from '../src/feature-flags/flag-lifecycle';
import { ALLOWED_FLAG_KEYS } from '../src/feature-flags/feature-flags.service';
import { version } from '../package.json';

/** Release index — major * 1000 + minor, so one cycle = one minor bump. */
function releaseIndex(v: string): number {
  const [major, minor] = v.split('.').map((n) => parseInt(n, 10));
  return major * 1000 + minor;
}

const current = releaseIndex(version);
const violations: string[] = [];

for (const [flag, deprecatedIn] of Object.entries(DEPRECATED_FLAGS)) {
  if (!ALLOWED_FLAG_KEYS.has(flag)) {
    violations.push(`"${flag}" is listed as deprecated but is not in ALLOWED_FLAG_KEYS — remove it from DEPRECATED_FLAGS`);
  } else if (current - releaseIndex(deprecatedIn) > 1) {
    violations.push(`"${flag}" deprecated in ${deprecatedIn}, still present in ${version} — remove the flag and its guarded code`);
  }
}

if (violations.length) {
  console.error('Deprecated feature flag check failed:\n' + violations.map((v) => `  - ${v}`).join('\n'));
  process.exit(1);
}
console.log(`Deprecated feature flag check passed (${Object.keys(DEPRECATED_FLAGS).length} deprecated flag(s)).`);
