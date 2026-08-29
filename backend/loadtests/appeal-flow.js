/**
 * Authenticated appeal write flow — build (includes Soroban simulate) + submit.
 *
 * Simulates a burst of concurrent appeal submissions (e.g. after a batch of
 * claims is rejected together). Write VU counts stay low to avoid hammering
 * Soroban RPC. Coordinate with RPC providers before increasing.
 *
 * Endpoints covered:
 *   POST /claims/:id/appeal/build-transaction  — build + simulate_transaction
 *   POST /claims/:id/appeal                     — submit signed XDR (optional)
 *
 * Stages:
 *   0→5 VUs over 30 s   (ramp / burst)
 *   5 VUs for 2 min     (sustained)
 *   5→0 VUs over 30 s   (ramp down)
 *
 * Baseline thresholds (regression tracking):
 *   appeal-build   p(95) < 3000 ms, p(99) < 8000 ms
 *   appeal-submit  p(95) < 4000 ms, p(99) < 10000 ms  (when SUBMIT enabled)
 *   http_req_failed < 2%
 *   checks > 98%
 *
 * Usage:
 *   BASE_URL=https://staging.niffyinsur.com/api \
 *   TEST_JWT=<staging-test-token> \
 *   APPEAL_CLAIM_IDS=101,102,103 \
 *   k6 run loadtests/appeal-flow.js
 *
 * Optional real submit (creates on-chain txs — staging only, pre-signed XDRs):
 *   APPEAL_SUBMIT=1 APPEAL_SIGNED_XDR=... APPEAL_TX_HASH=...
 *
 * NEVER run against production endpoints.
 */

import { sleep } from 'k6';
import http from 'k6/http';
import { check } from 'k6';
import { params } from './lib/helpers.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const JWT = __ENV.TEST_JWT || '';
const SUBMIT = __ENV.APPEAL_SUBMIT === '1';
const SIGNED_XDR = __ENV.APPEAL_SIGNED_XDR || '';
const TX_HASH = __ENV.APPEAL_TX_HASH || '';

const CLAIM_IDS = (__ENV.APPEAL_CLAIM_IDS || '1,2,3')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const TEST_CLAIMANTS = [
  'GTEST000000000000000000000000000000000000000000000000000001',
  'GTEST000000000000000000000000000000000000000000000000000002',
  'GTEST000000000000000000000000000000000000000000000000000003',
];

if (!JWT) {
  console.warn(
    '[appeal-flow] TEST_JWT is not set — authenticated endpoints will return 401. ' +
      'See loadtests/README.md for credential generation instructions.',
  );
}

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '2m', target: 5 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{endpoint:appeal-build}': ['p(95)<3000', 'p(99)<8000'],
    'http_req_duration{endpoint:appeal-submit}': ['p(95)<4000', 'p(99)<10000'],
    checks: ['rate>0.98'],
  },
};

export default function () {
  const claimId = CLAIM_IDS[Math.floor(Math.random() * CLAIM_IDS.length)];
  const claimant = TEST_CLAIMANTS[Math.floor(Math.random() * TEST_CLAIMANTS.length)];

  // 1. Build + simulate (RPC) — primary load path
  const buildRes = http.post(
    `${BASE_URL}/claims/${claimId}/appeal/build-transaction`,
    JSON.stringify({
      claimant,
      claimId,
      reason: 'k6 appeal load test — staging only',
    }),
    {
      ...params(JWT),
      tags: { endpoint: 'appeal-build' },
    },
  );

  check(buildRes, {
    'appeal-build: status 200 or 4xx business': (r) =>
      r.status === 200 || (r.status >= 400 && r.status < 500),
    'appeal-build: has body': (r) => !!r.body && r.body.length > 0,
  });

  sleep(Math.random() * 2 + 1);

  // 2. Submit — only when explicitly enabled with a pre-signed envelope
  if (SUBMIT && SIGNED_XDR && TX_HASH) {
    const submitRes = http.post(
      `${BASE_URL}/claims/${claimId}/appeal`,
      JSON.stringify({
        transactionXdr: SIGNED_XDR,
        txHash: TX_HASH,
      }),
      {
        ...params(JWT),
        tags: { endpoint: 'appeal-submit' },
      },
    );

    check(submitRes, {
      'appeal-submit: status 200 or idempotent/client error': (r) =>
        r.status === 200 || (r.status >= 400 && r.status < 500),
      'appeal-submit: has body': (r) => !!r.body && r.body.length > 0,
    });
  } else {
    // Exercise the submit route shape without broadcasting a real tx: omit body
    // fields so validation runs (auth + DTO) without Soroban submit side effects.
    const submitRes = http.post(
      `${BASE_URL}/claims/${claimId}/appeal`,
      JSON.stringify({
        transactionXdr: 'AAAA_K6_APPEAL_LOADTEST_NO_CHAIN_SUBMIT==',
        txHash: `k6-appeal-loadtest-${__VU}-${__ITER}`,
      }),
      {
        ...params(JWT),
        tags: { endpoint: 'appeal-submit' },
      },
    );

    check(submitRes, {
      'appeal-submit: reached handler (not 401 when JWT set)': (r) =>
        JWT ? r.status !== 401 : true,
      'appeal-submit: has body': (r) => !!r.body && r.body.length > 0,
    });
  }

  sleep(Math.random() * 2 + 1);
}
