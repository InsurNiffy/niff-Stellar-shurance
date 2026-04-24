import { writeFileSync } from 'fs';
import { join } from 'path';
import { renderEnvExample } from '../src/config/env.definitions';

const outputPath = join(__dirname, '..', '.env.example');
writeFileSync(outputPath, renderEnvExample(), 'utf8');
console.log(`Wrote ${outputPath}`);
