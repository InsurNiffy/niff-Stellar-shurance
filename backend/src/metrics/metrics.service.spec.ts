import { MetricsService } from './metrics.service';
import { MetricsCardinalityGuard } from './cardinality-guard.service';

describe('MetricsService — http_request_duration_seconds histogram', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(new MetricsCardinalityGuard());
  });

  it('histogram is registered with method, route, status_code labels', () => {
    const desc = service.httpRequestDuration;
    expect(desc).toBeDefined();
    // Observe does not throw with all three labels present
    expect(() =>
      service.recordHttpRequest({ method: 'GET', route: '/claims', statusCode: 200, durationMs: 50 }),
    ).not.toThrow();
  });

  it('recordHttpRequest increments httpRequestTotal', async () => {
    service.recordHttpRequest({ method: 'POST', route: '/policies', statusCode: 201, durationMs: 80 });
    const metrics = await service.getMetrics();
    expect(metrics).toContain('http_requests_total');
    expect(metrics).toContain('"POST"');
  });

  it('recordHttpRequest increments http5xxTotal on 5xx responses', async () => {
    service.recordHttpRequest({ method: 'GET', route: '/claims/:id', statusCode: 500, durationMs: 10 });
    const metrics = await service.getMetrics();
    expect(metrics).toContain('http_5xx_errors_total');
  });

  it('does not increment http5xxTotal on 4xx responses', async () => {
    // Create fresh service to start with zero counters
    const fresh = new MetricsService(new MetricsCardinalityGuard());
    fresh.recordHttpRequest({ method: 'GET', route: '/claims/:id', statusCode: 404, durationMs: 5 });
    const metrics = await fresh.getMetrics();
    // Counter should be zero (not present or value 0)
    const match = metrics.match(/http_5xx_errors_total\{[^}]*\} (\d+)/);
    expect(match).toBeNull();
  });

  it('normaliseRoute strips numeric IDs', () => {
    expect(service.normaliseRoute('/claims/123')).toBe('/claims/:id');
    expect(service.normaliseRoute('/policies/456/claims/789')).toBe('/policies/:id/claims/:id');
  });

  it('normaliseRoute strips pure UUID segments', () => {
    // UUID with no leading digits — fully matched by the UUID regex
    expect(service.normaliseRoute('/events/abcdef00-e29b-41d4-a716-446655440000')).toBe('/events/:uuid');
  });

  it('histogram uses buckets suited for p95 SLA monitoring (includes 1s bucket)', async () => {
    service.recordHttpRequest({ method: 'GET', route: '/health', statusCode: 200, durationMs: 1200 });
    const metrics = await service.getMetrics();
    // The 1 s bucket (le="1") must exist for the SLA recording rule to work
    expect(metrics).toContain('le="1"');
  });
});

describe('MetricsService — bullmq_queue_active_workers gauge (#874)', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(new MetricsCardinalityGuard());
  });

  it('gauge is registered with queue label', () => {
    expect(service.queueActiveWorkers).toBeDefined();
    expect(() =>
      service.recordQueueActiveWorkers({ queue: 'tx-submit', count: 2 }),
    ).not.toThrow();
  });

  it('recordQueueActiveWorkers sets gauge value per queue', async () => {
    service.recordQueueActiveWorkers({ queue: 'tx-submit', count: 1 });
    service.recordQueueActiveWorkers({ queue: 'claim-events', count: 3 });
    const metrics = await service.getMetrics();
    expect(metrics).toContain('bullmq_queue_active_workers');
    expect(metrics).toContain('queue="tx-submit"');
    expect(metrics).toContain('queue="claim-events"');
  });

  it('gauge value reflects latest update', async () => {
    service.recordQueueActiveWorkers({ queue: 'tx-submit', count: 0 });
    service.recordQueueActiveWorkers({ queue: 'tx-submit', count: 5 });
    const metrics = await service.getMetrics();
    // Should contain 5, not 0
    const txSubmitMatch = metrics.match(/bullmq_queue_active_workers\{queue="tx-submit"[^}]*\}\s+(\d+)/);
    expect(txSubmitMatch?.[1]).toBe('5');
  });
});

describe('MetricsService — queue depth and processing duration (#1112)', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(new MetricsCardinalityGuard());
  });

  it('queueDepth gauge is registered with queue label', () => {
    expect(service.queueDepth).toBeDefined();
    expect(() => service.recordQueueDepth({ queue: 'claim-events', depth: 10 })).not.toThrow();
  });

  it('recordQueueDepth sets gauge value per queue', async () => {
    service.recordQueueDepth({ queue: 'claim-events', depth: 5 });
    service.recordQueueDepth({ queue: 'tx-submit', depth: 2 });
    const metrics = await service.getMetrics();
    expect(metrics).toContain('bullmq_queue_depth');
    expect(metrics).toContain('queue="claim-events"');
  });

  it('jobProcessingDuration histogram is registered', () => {
    expect(service.jobProcessingDuration).toBeDefined();
    expect(() =>
      service.recordJobProcessingDuration({
        queue: 'claim-events',
        jobName: 'process-claim',
        status: 'completed',
        durationMs: 500,
      }),
    ).not.toThrow();
  });

  it('recordJobProcessingDuration tracks completed and failed jobs', async () => {
    service.recordJobProcessingDuration({
      queue: 'claim-events',
      jobName: 'process-claim',
      status: 'completed',
      durationMs: 1200,
    });
    service.recordJobProcessingDuration({
      queue: 'claim-events',
      jobName: 'process-claim',
      status: 'failed',
      durationMs: 500,
    });
    const metrics = await service.getMetrics();
    expect(metrics).toContain('bullmq_job_processing_duration_seconds');
    expect(metrics).toContain('status="completed"');
    expect(metrics).toContain('status="failed"');
  });
});
