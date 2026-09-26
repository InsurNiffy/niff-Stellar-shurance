import { GatewayTimeoutException } from '@nestjs/common';
import { SimulationTimeoutError } from './soroban.client';

describe('SimulationTimeoutError (issue #895)', () => {
  it('is a GatewayTimeoutException', () => {
    const err = new SimulationTimeoutError(30_000);
    expect(err).toBeInstanceOf(GatewayTimeoutException);
  });

  it('returns 504 status', () => {
    const err = new SimulationTimeoutError(30_000);
    expect(err.getStatus()).toBe(504);
  });

  it('includes SIMULATION_TIMEOUT error code in response body', () => {
    const err = new SimulationTimeoutError(5_000);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body['error']).toBe('SIMULATION_TIMEOUT');
    expect(body['message']).toContain('5000');
  });

  it('includes the timeout duration in the message', () => {
    const err = new SimulationTimeoutError(12_345);
    const body = err.getResponse() as Record<string, unknown>;
    expect(String(body['message'])).toContain('12345');
  });
});
