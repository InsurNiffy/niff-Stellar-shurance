/**
 * Health + quote endpoints load test.
 *
 * Covers the quote calculation path which is CPU-bound (risk scoring).
 * Useful for detecting regressions after algorithm changes.
 *
 * Usage:
 *   BASE_URL=https://staging.niffyinsur.com k6 run loadtests/health-and-quotes.js
 */

import { sleep } from 'k6';
import { get, post } from './lib/helpers.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '2m', target: 5 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:health}': ['p(95)<100'],
    'http_req_duration{endpoint:quote}': ['p(95)<1000', 'p(99)<3000'],
    checks: ['rate>0.99'],
  },
};

const RISK_CATEGORIES = ['LOW', 'MEDIUM', 'HIGH'];
const CONTRACT_TYPES = ['DEFI_PROTOCOL', 'SMART_CONTRACT', 'LIQUIDITY_POOL', 'BRIDGE'];

export default function () {
  // Health check
  get(`${BASE_URL}/health`, null, 'health');
  sleep(0.5);

  // Quote request
  const riskCategory = RISK_CATEGORIES[Math.floor(Math.random() * RISK_CATEGORIES.length)];
  const contractType = CONTRACT_TYPES[Math.floor(Math.random() * CONTRACT_TYPES.length)];

  post(
    `${BASE_URL}/quotes`,
    {
      contractAddress: 'GTEST000000000000000000000000000000000000000000000000000001',
      coverageAmount: Math.floor(Math.random() * 9000) + 1000,
      duration: 30,
      riskCategory,
      contractType,
    },
    null,
    'quote',
    201,
  );
  sleep(Math.random() * 2 + 1);
}
