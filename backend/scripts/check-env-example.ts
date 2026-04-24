import { readFileSync } from 'fs';
import { join } from 'path';
import { renderEnvExample } from '../src/config/env.definitions';

const envExamplePath = join(__dirname, '..', '.env.example');
const expected = renderEnvExample();
const actual = readFileSync(envExamplePath, 'utf8');

if (actual !== expected) {
  console.error('.env.example is out of date. Run `npm run env:example:generate` in backend/.');
  process.exit(1);
}

console.log('.env.example is up to date.');
