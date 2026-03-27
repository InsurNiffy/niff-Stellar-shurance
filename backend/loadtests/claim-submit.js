/**
 * Authenticated write flow — claim transaction build + submit.
 *
 * Simulates a small number of users submitting claims concurrently.
 * Write flows are intentionally kept at low VU counts to avoid hammering
 * the Soroban RPC endpoint. Coordinate with RPC providers before increasing.
 *
 * Stages:
 *   0→3 VUs over 30 s   (ramp up)
 *   3 VUs for 2 min     (sustained)
 *   3→0 VUs over 30 s   (ramp down)
 *
 * Thresholds:
 *   p(95) < 3000 ms  — write flows involve RPC calls, higher latency expected
 *   error rate < 2%
 *
 * Usage:
 *   BASE_URL=https://staging.niffyinsur.com \
 *   TEST_JWT=<staging-test-token> \
 *   k6 run loadtests/claim-submit.js
 *
 * NEVER run against production endpoints.
 */

import { sleep } from 'k6';
import { get, post } from './lib/helpers.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';
const JWT = __ENV.TEST_JWT || '';

if (!JWT) {
  console.warn(
    '[claim-submit] TEST_JWT is not set — authenticated endpoints will return 401. ' +
    'See loadtests/README.md for credential generation instructions.',
  );
}

export const options = {
  stages: [
    { duration: '30s', target: 3 },
    { duration: '2m', target: 3 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{endpoint:build-tx}': ['p(95)<3000', 'p(99)<8000'],
    checks: ['rate>0.98'],
  },
};

// Test wallet addresses — staging only, no real funds
const TEST_HOLDERS = [
  'GTEST000000000000000000000000000000000000000000000000000001',
  'GTEST000000000000000000000000000000000000000000000000000002',
  'GTEST000000000000000000000000000000000000000000000000000003',
];

export default function () {
  const holder = TEST_HOLDERS[Math.floor(Math.random() * TEST_HOLDERS.length)];

  // 1. Browse claims first (realistic user journey)
  get(`${BASE_URL}/claims?status=pending`, JWT, 'claims-list');
  sleep(Math.random() * 3 + 2); // 2–5s reading

  // 2. Build a claim transaction (RPC call to Soroban)
  post(
    `${BASE_URL}/claims/build-transaction`,
    {
      holder,
      policyId: 1,
      amount: '100',
      details: 'k6 load test claim — staging only',
      imageUrls: [],
    },
    JWT,
    'build-tx',
    200,
  );
  sleep(Math.random() * 2 + 1); // 1–3s simulating wallet signing

  // Note: we do NOT call /claims/submit in load tests to avoid creating
  // real on-chain transactions. The build-transaction endpoint exercises
  // the RPC path without side effects.
}
