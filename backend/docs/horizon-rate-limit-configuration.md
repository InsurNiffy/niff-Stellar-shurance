# Horizon Rate Limit Configuration

This document outlines the configuration and operation of the Horizon API rate limiting system designed to prevent 429 errors and ensure reliable Stellar network integration.

## Overview

The Horizon rate limit service implements a token bucket algorithm with request queuing to manage Stellar Horizon API calls efficiently. This prevents hitting Horizon's per-IP rate limits while maintaining system responsiveness.

## Rate Limit Algorithm

### Token Bucket Implementation

The service uses a Redis-based token bucket algorithm with the following characteristics:

- **Refill Rate**: Configurable requests per second (default: 5 RPS)
- **Burst Capacity**: Maximum tokens available (default: 20 tokens)
- **Token Consumption**: 1 token per request
- **Refill Mechanism**: Continuous token replenishment based on elapsed time

### Queue Management

When the token bucket is empty, requests are queued rather than rejected:

- **Queue Size**: Maximum 100 queued requests (configurable)
- **Queue Timeout**: 30 seconds per request (configurable)
- **Processing**: Queue processed every 100ms
- **Retry Logic**: Failed requests are retried up to 3 times with exponential backoff

## Configuration Parameters

### Environment Variables

```bash
# Core rate limiting settings
HORIZON_RATE_LIMIT_RPS=5              # Requests per second
HORIZON_BURST_CAPACITY=20              # Maximum burst capacity
HORIZON_QUEUE_MAX_SIZE=100             # Maximum queued requests
HORIZON_QUEUE_TIMEOUT_MS=30000        # Queue timeout in milliseconds

# Optional Horizon API settings
HORIZON_API_KEY=your_api_key_here     # Horizon API key if available
```

### Configuration Examples

#### Development Environment
```bash
HORIZON_RATE_LIMIT_RPS=2
HORIZON_BURST_CAPACITY=10
HORIZON_QUEUE_MAX_SIZE=50
HORIZON_QUEUE_TIMEOUT_MS=15000
```

#### Production Environment
```bash
HORIZON_RATE_LIMIT_RPS=5
HORIZON_BURST_CAPACITY=20
HORIZON_QUEUE_MAX_SIZE=100
HORIZON_QUEUE_TIMEOUT_MS=30000
```

#### High-Traffic Environment
```bash
HORIZON_RATE_LIMIT_RPS=10
HORIZON_BURST_CAPACITY=50
HORIZON_QUEUE_MAX_SIZE=200
HORIZON_QUEUE_TIMEOUT_MS=45000
```

## Metrics and Monitoring

### Prometheus Metrics

The system exposes the following metrics for monitoring:

```prometheus
# Token bucket status
horizon_rate_limit_tokens_remaining{identifier="horizon-api"}

# Queue status
horizon_rate_limit_queue_depth

# Request counts
horizon_rate_limit_requests_total
horizon_rate_limit_allowed_requests_total
horizon_rate_limit_rejected_requests_total
horizon_rate_limit_queued_requests_total

# Performance metrics
horizon_rate_limit_wait_time_seconds
```

### Monitoring Dashboard

Key metrics to monitor:

1. **Token Remaining**: Should stay above 0 under normal load
2. **Queue Depth**: Should remain low (< 10) under normal conditions
3. **Wait Time**: Average wait time should be < 1 second
4. **Rejection Rate**: Should be < 1% of total requests

### Alerting Rules

```yaml
# Prometheus alerting rules
groups:
  - name: horizon-rate-limit
    rules:
      - alert: HorizonRateLimitHighRejectionRate
        expr: rate(horizon_rate_limit_rejected_requests_total[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High Horizon API rejection rate"
          description: "Horizon API rejection rate is {{ $value }} requests/second"

      - alert: HorizonRateLimitQueueDepth
        expr: horizon_rate_limit_queue_depth > 50
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Horizon API queue depth high"
          description: "Horizon API queue depth is {{ $value }} requests"

      - alert: HorizonRateLimitTokensExhausted
        expr: horizon_rate_limit_tokens_remaining{identifier="horizon-api"} == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Horizon API tokens exhausted"
          description: "Horizon rate limit bucket is empty"
```

## Integration Guide

### Service Integration

The Horizon rate limit service is automatically integrated with the HorizonService:

```typescript
// Automatic usage in HorizonService
const response = await this.rateLimitService.executeWithRateLimit<Record<string, unknown>>(
  url,
  { headers, signal: AbortSignal.timeout(10_000) },
  'horizon-api'
);
```

### Manual Usage

For direct service usage:

```typescript
import { HorizonRateLimitService } from './horizon-rate-limit.service';

// Check rate limit only
const result = await this.rateLimitService.checkRateLimit('my-service');
if (result.allowed) {
  // Proceed with request
}

// Execute with automatic rate limiting and queuing
const data = await this.rateLimitService.executeWithRateLimit<MyResponseType>(
  'https://horizon.stellar.org/accounts/.../operations',
  { timeout: 10000 },
  'my-service'
);
```

## Performance Considerations

### Optimization Strategies

1. **Batch Requests**: Combine multiple operations when possible
2. **Caching**: Implement application-level caching for frequently accessed data
3. **Request Prioritization**: Use different identifiers for critical vs. non-critical requests
4. **Connection Pooling**: Reuse HTTP connections for better performance

### Load Testing

Use the following configuration for load testing:

```bash
# Simulate high load
HORIZON_RATE_LIMIT_RPS=20
HORIZON_BURST_CAPACITY=100
HORIZON_QUEUE_MAX_SIZE=500
HORIZON_QUEUE_TIMEOUT_MS=60000
```

### Capacity Planning

Calculate required rate limits based on expected load:

```typescript
// Example calculation
const expectedRPS = 1000; // Expected requests per second
const horizonLimit = 5;   // Horizon's rate limit per IP
const instances = Math.ceil(expectedRPS / horizonLimit); // 200 instances needed
```

## Troubleshooting

### Common Issues

#### High Queue Depth
**Symptoms**: Requests taking long time to complete
**Causes**: Rate limit too low for current load
**Solutions**:
- Increase `HORIZON_RATE_LIMIT_RPS`
- Add more application instances
- Implement better caching

#### Frequent Timeouts
**Symptoms**: Requests failing with timeout errors
**Causes**: Queue timeout too low or system overloaded
**Solutions**:
- Increase `HORIZON_QUEUE_TIMEOUT_MS`
- Check Horizon API status
- Reduce request rate

#### Token Exhaustion
**Symptoms**: All requests being rejected
**Causes**: Sudden traffic spike or misconfiguration
**Solutions**:
- Increase burst capacity
- Check for runaway processes
- Verify configuration values

### Debugging Tools

#### Redis Inspection
```bash
# Check token bucket state
redis-cli HGETALL "horizon:rate_limit:tokens:horizon-api"

# Monitor queue depth
redis-cli LLEN "horizon:rate_limit:queue"

# View metrics
redis-cli HGETALL "horizon:rate_limit:metrics"
```

#### Log Analysis
```bash
# View rate limit logs
grep "HorizonRateLimitService" /var/log/niffyinsure/app.log | tail -100

# Check for queue full errors
grep "queue is full" /var/log/niffyinsure/app.log

# Monitor wait times
grep "wait time" /var/log/niffyinsure/app.log
```

## Best Practices

### Configuration Management

1. **Environment-Specific Settings**: Use different configurations per environment
2. **Gradual Changes**: Adjust rate limits gradually to avoid disruption
3. **Monitoring**: Always monitor metrics after configuration changes
4. **Documentation**: Keep configuration changes documented

### Operational Procedures

1. **Regular Reviews**: Review rate limit settings monthly
2. **Capacity Planning**: Plan for traffic growth in advance
3. **Incident Response**: Have procedures for rate limit incidents
4. **Performance Testing**: Test configuration changes in staging

### Security Considerations

1. **API Key Protection**: Secure Horizon API keys properly
2. **Rate Limit Bypass**: Monitor for attempts to bypass rate limiting
3. **Resource Abuse**: Implement additional protection against abuse
4. **Access Control**: Limit who can modify rate limit settings

## Integration Tests

### Test Scenarios

```typescript
describe('Horizon Rate Limit', () => {
  it('should allow requests within limit', async () => {
    const results = await Promise.all([
      rateLimitService.checkRateLimit(),
      rateLimitService.checkRateLimit(),
      rateLimitService.checkRateLimit(),
    ]);
    
    expect(results.every(r => r.allowed)).toBe(true);
  });

  it('should queue requests when limit exceeded', async () => {
    // Exhaust tokens
    for (let i = 0; i < burstCapacity + 1; i++) {
      await rateLimitService.checkRateLimit();
    }
    
    // Next request should be queued
    const result = await rateLimitService.executeWithRateLimit(
      'https://horizon.stellar.org/...'
    );
    
    expect(result).toBeDefined();
  });

  it('should timeout queued requests', async () => {
    // Fill queue and test timeout
    // Implementation depends on test setup
  });
});
```

## Emergency Procedures

### Rate Limit Exhaustion

1. **Immediate Actions**:
   - Check Horizon API status
   - Verify rate limit configuration
   - Monitor queue depth

2. **Recovery Steps**:
   - Temporarily increase rate limits if needed
   - Add more application instances
   - Implement emergency caching

3. **Post-Incident**:
   - Review configuration changes
   - Update capacity planning
   - Document lessons learned

### Queue Full Errors

1. **Immediate Response**:
   - Check queue depth metrics
   - Verify request patterns
   - Check for runaway processes

2. **Resolution**:
   - Increase queue size temporarily
   - Identify and fix request patterns
   - Scale horizontally if needed

## Configuration Reference

### Default Values

| Parameter | Default | Description |
|-----------|---------|-------------|
| `HORIZON_RATE_LIMIT_RPS` | 5 | Requests per second |
| `HORIZON_BURST_CAPACITY` | 20 | Maximum tokens |
| `HORIZON_QUEUE_MAX_SIZE` | 100 | Queue size |
| `HORIZON_QUEUE_TIMEOUT_MS` | 30000 | Queue timeout |

### Recommended Values

| Environment | RPS | Burst | Queue | Timeout |
|-------------|-----|-------|-------|----------|
| Development | 2 | 10 | 50 | 15s |
| Staging | 3 | 15 | 75 | 20s |
| Production | 5 | 20 | 100 | 30s |
| High-Traffic | 10 | 50 | 200 | 45s |

## Support and Maintenance

### Regular Maintenance Tasks

- Weekly: Review rate limit metrics
- Monthly: Update configuration based on usage patterns
- Quarterly: Performance testing and optimization
- Annually: Capacity planning review

### Contact Information

- **Technical Support**: tech-support@niffyinsure.com
- **DevOps Team**: devops@niffyinsure.com
- **Engineering**: engineering@niffyinsure.com

### Related Documentation

- [Stellar Horizon API Documentation](https://developers.stellar.org/api/horizon/)
- [Rate Limiting Best Practices](./rate-limiting-best-practices.md)
- [Monitoring Guide](./monitoring-guide.md)
- [Incident Response Procedure](./incident-response.md)
