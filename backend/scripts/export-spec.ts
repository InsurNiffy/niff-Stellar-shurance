/**
 * Exports the openapiSpec object to backend/openapi.json.
 * Run via: npm run export-spec
 * Used by: make generate-client, CI drift guard
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { openapiSpec } from '../src/openapi/spec';

const outPath = resolve(__dirname, '..', 'openapi.json');
writeFileSync(outPath, JSON.stringify(openapiSpec, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${outPath}`);
