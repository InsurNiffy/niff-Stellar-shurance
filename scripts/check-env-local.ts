#!/usr/bin/env ts-node
/**
 * scripts/check-env-local.ts
 *
 * Local dev setup check: validates that .env.local (frontend) and backend/.env
 * contain all required variables defined in their respective schemas.
 *
 * Usage:
 *   npx ts-node scripts/check-env-local.ts
 *   # or via Makefile:
 *   make check-env
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

// ── Minimal .env parser (no dotenv dependency at root level) ────────────────
function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const result: Record<string, string> = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

// ── Backend required vars (sourced from env.definitions.ts required fields) ─
const BACKEND_REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'SOROBAN_RPC_URL',
  'HORIZON_URL',
  'STELLAR_NETWORK_PASSPHRASE',
  'JWT_SECRET',
  'ADMIN_TOKEN',
  'FRONTEND_ORIGINS',
  'CAPTCHA_SECRET_KEY',
  'IP_HASH_SALT',
];

// ── Frontend required vars ──────────────────────────────────────────────────
const FRONTEND_REQUIRED = [
  'NEXT_PUBLIC_API_URL',
];

interface CheckResult {
  file: string;
  missing: string[];
  empty: string[];
}

function checkFile(
  filePath: string,
  required: string[],
  label: string,
): CheckResult {
  const vars = parseEnvFile(filePath);
  const missing: string[] = [];
  const empty: string[] = [];

  for (const key of required) {
    if (!(key in vars)) {
      missing.push(key);
    } else if (!vars[key]) {
      empty.push(key);
    }
  }

  return { file: label, missing, empty };
}

function printResult(result: CheckResult): boolean {
  const ok = result.missing.length === 0 && result.empty.length === 0;
  if (ok) {
    console.log(`✅  ${result.file} — all required vars present`);
    return true;
  }
  console.error(`❌  ${result.file}`);
  if (result.missing.length > 0) {
    console.error(`    Missing keys (not in file):`);
    result.missing.forEach((k) => console.error(`      - ${k}`));
  }
  if (result.empty.length > 0) {
    console.error(`    Empty values (key present but no value):`);
    result.empty.forEach((k) => console.error(`      - ${k}`));
  }
  return false;
}

const backendEnvPath = join(ROOT, 'backend', '.env');
const frontendEnvPath = join(ROOT, 'frontend', '.env.local');

console.log('\n🔍  Checking local environment files...\n');

const results = [
  checkFile(backendEnvPath, BACKEND_REQUIRED, `backend/.env`),
  checkFile(frontendEnvPath, FRONTEND_REQUIRED, `frontend/.env.local`),
];

let allOk = true;
for (const result of results) {
  if (!printResult(result)) allOk = false;
}

if (!allOk) {
  console.error(
    '\n⚠️  Fix the issues above before starting the dev server.\n' +
    '   Copy backend/.env.example → backend/.env and fill in the blanks.\n' +
    '   Copy frontend/.env.local.example → frontend/.env.local and fill in the blanks.\n',
  );
  process.exit(1);
}

console.log('\n✅  All required environment variables are set.\n');
