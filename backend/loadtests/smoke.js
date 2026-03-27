/**
 * Smoke test — quick sanity check before any load run.
 *
 * 2 VUs, 30 seconds. Verifies all critical endpoints return 200.
 * Run this first to confirm staging is healthy.
 *
 * Usage:
 *   BASE_URL=https://staging.niffyinsur.com k6 run loadtests/smoke.js
 */

import { sleep } from 'k6';
import { get } from './lib/helpers.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';

export const options = {
  vus: 2,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  get(`${BASE_URL}/health`, null, 'health');
  sleep(1);

  get(`${BASE_URL}/claims`, null, 'claims-list');
  sleep(1);

  get(`${BASE_URL}/claims?limit=5`, null, 'claims-list-small');
  sleep(1);
}
