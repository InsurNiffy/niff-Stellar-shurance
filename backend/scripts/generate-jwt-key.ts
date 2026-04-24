import { randomBytes } from 'crypto';
import { chmodSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const outputFlagIndex = args.indexOf('--output');
const outputPath =
  outputFlagIndex >= 0 && args[outputFlagIndex + 1]
    ? resolve(args[outputFlagIndex + 1])
    : null;

const key = randomBytes(64).toString('base64url');
const timestamp = new Date().toISOString();
const payload = [
  '# Generated JWT signing key',
  `# Generated at: ${timestamp}`,
  '# Store this value in your secrets manager, not in git.',
  `JWT_SECRET=${key}`,
  '',
].join('\n');

if (outputPath) {
  writeFileSync(outputPath, payload, { encoding: 'utf8', mode: 0o600 });
  chmodSync(outputPath, 0o600);
  console.log(`Wrote JWT key material to ${outputPath} with mode 600`);
} else {
  process.stdout.write(payload);
}
