/**
 * Read-heavy load test — claims list endpoint.
 *
 * Simulates the most common production traffic pattern: multiple concurrent
 * users browsing the claims board with various filters and pagination.
 *
 * Stages:
 *   0→10 VUs over 1 min  (ramp up)
 *   10 VUs for 3 min     (sustained load)
 *   10→0 VUs over 30 s   (ramp down)
 *
 * Thresholds (regression gates):
 *   p(95) < 500 ms   — cached list responses should be fast
 *   p(99) < 2000 ms  — worst-case acceptable latency
 *   error rate < 1%
 *
 * Usage:
 *   BASE_URL=https://staging.niffyinsur.com k6 run loadtests/claims-list.js
 *
 * To save a dated report:
 *   k6 run --out json=docs/perf/$(date +%Y-%m-%d)-claims-list.json loadtests/claims-list.js
 */

import { sleep } from 'k6';
import { get } from './lib/helpers.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '3m', target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:claims-list}': ['p(95)<500', 'p(99)<2000'],
    'http_req_duration{endpoint:claims-detail}': ['p(95)<800', 'p(99)<3000'],
    checks: ['rate>0.99'],
  },
};

// Realistic claim IDs — replace with IDs that exist in staging
const CLAIM_IDS = [1, 2, 3, 4, 5];
const STATUSES = ['pending', 'approved', 'rejected', 'paid'];

export default function () {
  // 1. List all claims (first page)
  get(`${BASE_URL}/claims`, null, 'claims-list');
  sleep(Math.random() * 2 + 0.5); // 0.5–2.5s think time

  // 2. List with status filter (simulates filter bar usage)
  const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
  get(`${BASE_URL}/claims?status=${status}&limit=20`, null, 'claims-list');
  sleep(Math.random() * 1.5 + 0.5);

  // 3. Fetch a random claim detail
  const claimId = CLAIM_IDS[Math.floor(Math.random() * CLAIM_IDS.length)];
  get(`${BASE_URL}/claims/${claimId}`, null, 'claims-detail');
  sleep(Math.random() * 2 + 1); // 1–3s think time (reading the claim)
}
