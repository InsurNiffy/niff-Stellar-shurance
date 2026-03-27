/**
 * Shared helpers for NiffyInsure k6 load test scripts.
 */

import { check } from 'k6';
import http from 'k6/http';

/**
 * Build common request params with JSON content-type and optional auth.
 * @param {string|null} jwt - Bearer token, or null for unauthenticated requests
 * @returns {import('k6/http').Params}
 */
export function params(jwt = null) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`;
  }
  return { headers, timeout: '30s' };
}

/**
 * Assert standard HTTP response checks and record them.
 * @param {import('k6/http').RefinedResponse} res
 * @param {number} expectedStatus
 * @param {string} label
 */
export function assertResponse(res, expectedStatus, label) {
  check(res, {
    [`${label}: status ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${label}: response time < 2s`]: (r) => r.timings.duration < 2000,
    [`${label}: has body`]: (r) => r.body && r.body.length > 0,
  });
}

/**
 * GET with standard checks.
 */
export function get(url, jwt, label) {
  const res = http.get(url, params(jwt));
  assertResponse(res, 200, label);
  return res;
}

/**
 * POST with standard checks.
 */
export function post(url, body, jwt, label, expectedStatus = 200) {
  const res = http.post(url, JSON.stringify(body), params(jwt));
  assertResponse(res, expectedStatus, label);
  return res;
}
