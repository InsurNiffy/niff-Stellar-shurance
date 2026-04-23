/**
 * CI Check: Tenant Query Isolation
 *
 * Scans all TypeScript files under backend/src/ for Prisma queries on
 * tenant-scoped models (Claim, Policy) that do NOT use the tenant-filter
 * helpers (claimTenantWhere, policyTenantWhere, tenantFilter).
 *
 * Exit code:
 *   0 = no violations found
 *   1 = one or more queries bypass tenant filtering
 *
 * Usage:
 *   npx ts-node backend/scripts/check-tenant-queries.ts
 *   # or
 *   npm run ci:tenant-check
 */
import * as fs from 'fs';
import * as path from 'path';
import { queryBypassesTenantFilter } from '../src/tenant/tenant-filter.helper';

const SRC_DIR = path.join(__dirname, '../src');
const EXCLUDED_FILES = [
  // Test files are allowed to simulate raw queries for testing helpers
  /\.test\.ts$/,
  /\.spec\.ts$/,
  // The helper file itself defines the helpers
  /tenant-filter\.helper\.ts$/,
  // Scripts may do raw queries for migrations/repair
  /scripts\//,
];

function shouldCheck(filePath: string): boolean {
  return !EXCLUDED_FILES.some((pattern) => pattern.test(filePath));
}

function* walkDir(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      yield* walkDir(fullPath);
    } else if (stat.isFile() && fullPath.endsWith('.ts')) {
      yield fullPath;
    }
  }
}

function main(): void {
  let totalViolations = 0;
  const filesWithViolations: string[] = [];

  for (const filePath of walkDir(SRC_DIR)) {
    if (!shouldCheck(filePath)) continue;

    const code = fs.readFileSync(filePath, 'utf-8');
    const violations = queryBypassesTenantFilter(code);

    if (violations.length > 0) {
      totalViolations += violations.length;
      filesWithViolations.push(filePath);
      console.error(`\n${filePath}`);
      for (const v of violations) {
        console.error(`  ❌ ${v}`);
      }
    }
  }

  if (totalViolations > 0) {
    console.error(
      `\n❌ Tenant isolation check FAILED: ${totalViolations} violation(s) in ${filesWithViolations.length} file(s).\n`,
    );
    console.error(
      'Fix: wrap Prisma queries on Claim/Policy with claimTenantWhere() or policyTenantWhere().\n',
    );
    process.exit(1);
  }

  console.log('✅ Tenant isolation check PASSED: no queries bypass tenant filters.');
  process.exit(0);
}

main();

