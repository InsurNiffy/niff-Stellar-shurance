/**
 * GraphQL nested policy -> claims read baseline.
 *
 * Validates that representative graph reads remain efficient under staging load
 * and that deep malicious queries are rejected deterministically.
 *
 * Usage:
 *   BASE_URL=https://staging.niffyinsur.com/api \
 *   k6 run loadtests/graphql-policy-claim-nested.js
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { params } from './lib/helpers.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '3m', target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:graphql-nested}': ['p(95)<600', 'p(99)<2000'],
    'http_req_duration{endpoint:graphql-malicious}': ['p(95)<400'],
    checks: ['rate>0.99'],
  },
};

const nestedQuery = JSON.stringify({
  operationName: 'PoliciesWithClaims',
  query: `
    query PoliciesWithClaims {
      policies(first: 20) {
        items {
          id
          policyId
          claims(first: 10) {
            id
            status
          }
        }
      }
    }
  `,
});

const maliciousQuery = JSON.stringify({
  operationName: 'TooDeep',
  query: `
    query TooDeep {
      policy(id: "GHOLDER:1") {
        claims(first: 1) {
          policy {
            claims(first: 1) {
              policy {
                claims(first: 1) {
                  policy {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
});

export default function () {
  const nested = http.post(`${BASE_URL}/graphql`, nestedQuery, {
    ...params(),
    tags: { endpoint: 'graphql-nested' },
  });
  check(nested, {
    'nested query returns 200': (r) => r.status === 200,
    'nested query has no errors': (r) => !JSON.parse(r.body).errors,
  });

  sleep(Math.random() * 1.5 + 0.5);

  const malicious = http.post(`${BASE_URL}/graphql`, maliciousQuery, {
    ...params(),
    tags: { endpoint: 'graphql-malicious' },
  });
  check(malicious, {
    'malicious query returns 200 envelope': (r) => r.status === 200,
    'malicious query rejected deterministically': (r) => {
      const body = JSON.parse(r.body);
      return body.errors?.[0]?.extensions?.code === 'GRAPHQL_DEPTH_LIMIT';
    },
  });

  sleep(Math.random() * 2 + 1);
}
