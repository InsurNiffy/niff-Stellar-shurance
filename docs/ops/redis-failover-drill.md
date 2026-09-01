# Redis Failover Drill

## Overview

This document describes a scheduled drill to verify how the application behaves when Redis primary becomes unavailable and subsequently recovers. The drill tests three critical features that depend on Redis:
1. **Caching**: Session cache, user preferences, temporary data
2. **Queues**: Job processing, background tasks, email delivery
3. **Rate Limiting**: API rate limits, DDoS protection, request throttling

## Drill Frequency

- **Scheduled**: Weekly in staging environment
- **Run Time**: Off-peak hours (2-4 AM UTC)
- **Duration**: 15 minutes (5 min outage, 10 min recovery)
- **Environment**: Staging/test environment only (never production)

## Pre-Drill Checklist

- [ ] Monitoring and alerting configured
- [ ] Alert thresholds verified (no false positives)
- [ ] On-call engineer available to monitor
- [ ] Test data prepared in staging
- [ ] Load generator ready to simulate traffic
- [ ] Database connection pool healthy
- [ ] All application nodes ready

## Drill Steps

### Phase 1: Baseline Collection

1. **Record healthy metrics**
   ```bash
   # Capture current Redis status
   redis-cli -h staging-redis INFO > /tmp/redis_baseline.txt
   redis-cli -h staging-redis DBSIZE
   
   # Record application metrics
   curl -s http://staging-backend/metrics | grep redis > /tmp/app_baseline_redis.txt
   
   # Record queue depths
   redis-cli -h staging-redis LLEN queue:email
   redis-cli -h staging-redis LLEN queue:notifications
   redis-cli -h staging-redis LLEN queue:background-jobs
   ```

2. **Start load generation**
   ```bash
   # Simulate realistic traffic
   npm run load-test -- \
     --duration 15m \
     --concurrent-users 50 \
     --write-cache \
     --use-rate-limiting \
     --queue-jobs \
     --output /tmp/load_test_results.json &
   ```

3. **Record startup metrics** (5 minute baseline before failover)
   ```bash
   # Monitor for 5 minutes in healthy state
   # Expected: zero Redis errors, normal latency, queues processing
   ```

### Phase 2: Simulate Redis Primary Failure (5 minutes)

1. **Stop Redis primary**
   ```bash
   # For Docker-based Redis
   docker stop redis-primary
   
   # For Kubernetes-based Redis
   kubectl delete pod redis-0 -n production
   
   # For self-managed Redis
   systemctl stop redis-server
   ```

2. **Record behavior during outage**
   - Monitor application error rates
   - Check which features are affected:
     - **Cache**: Can application handle cache misses? Fallback to DB?
     - **Queues**: Are jobs accumulating? Will they be retried?
     - **Rate Limiting**: Are users rate-limited or API open?
   - Record metrics every 10 seconds

3. **Document specific behaviors**
   ```bash
   # Check error logs for Redis-related errors
   docker logs backend 2>&1 | grep -i redis > /tmp/redis_errors_during_outage.txt
   
   # Check queue status (should be failing to write)
   curl -s http://staging-backend/queue-status
   
   # Check API response times (should be elevated)
   curl -s http://staging-backend/metrics | grep request_duration
   ```

### Phase 3: Recovery Phase (10 minutes)

1. **Restart Redis primary**
   ```bash
   # For Docker
   docker start redis-primary
   
   # For Kubernetes
   kubectl rollout restart statefulset/redis -n production
   
   # For self-managed
   systemctl start redis-server
   ```

2. **Wait for Redis to sync** (replication lag)
   ```bash
   # Monitor replication status
   redis-cli -h staging-redis INFO replication
   
   # Wait for replicas to catch up
   until [ "$(redis-cli -h staging-redis-replica2 PING)" = "PONG" ]; do
     echo "Waiting for replica..."
     sleep 5
   done
   ```

3. **Monitor recovery behavior**
   - Check if queued jobs are being processed
   - Verify cache is being repopulated
   - Confirm rate limiting is functioning
   - Monitor error rates (should return to normal)

4. **Record recovery metrics**
   ```bash
   # After 10 minutes, collect final state
   redis-cli -h staging-redis DBSIZE
   redis-cli -h staging-redis LLEN queue:email
   redis-cli -h staging-redis LLEN queue:notifications
   
   # Check application metrics
   curl -s http://staging-backend/metrics | grep redis > /tmp/app_final_redis.txt
   ```

### Phase 4: Analysis and Documentation

1. **Feature Impact Analysis**

   **Caching**
   - [ ] Session cache: Did users get logged out? (Expected: Yes, they login again)
   - [ ] User preferences: Were they lost? (Expected: Fetched from DB on miss)
   - [ ] Temporary data: Was it lost? (Expected: Yes, retry operation if needed)
   - [ ] Recovery: How long to repopulate cache? (Expected: < 1 minute)

   **Queues**
   - [ ] Email queue: Were emails delayed? (Expected: Yes, but sent on recovery)
   - [ ] Notification queue: Were notifications delayed? (Expected: Yes, caught up after)
   - [ ] Background jobs: Did jobs fail or retry? (Expected: Retry on recovery)
   - [ ] Queue integrity: No lost messages? (Expected: Yes, Redis backed up)

   **Rate Limiting**
   - [ ] API rate limits: Were they enforced during outage? (Varies by implementation)
   - [ ] DDoS protection: Did it fail open or closed? (Document behavior)
   - [ ] Fairness: Were all users affected equally? (Expected: Yes)

2. **Performance Analysis**
   ```bash
   # Analyze load test results
   npm run analyze-load-test -- --input /tmp/load_test_results.json
   
   # Expected findings:
   # - Latency spikes during outage (normal)
   # - Some failed requests (acceptable)
   # - Recovery to normal within 1-2 minutes
   ```

3. **Error Analysis**
   ```bash
   # Identify categories of Redis-related errors
   grep -i redis /tmp/redis_errors_during_outage.txt | \
     sort | uniq -c | sort -rn
   
   # Check if errors are gracefully handled
   # or result in user-facing failures
   ```

## Success Criteria

Drill is **SUCCESSFUL** if:

- ✓ Caching: Degrades gracefully, serves from DB, recovers quickly
- ✓ Queues: No message loss, jobs processed on recovery
- ✓ Rate Limiting: Fails safely (open or closed, not compromised)
- ✓ Application: No crashes, errors logged appropriately
- ✓ Users: No account lockouts, data integrity maintained
- ✓ Recovery: Automatic failover works, manual intervention not needed

Drill is **FAILED** if:

- ✗ Users locked out of accounts
- ✗ Jobs permanently lost
- ✗ Data corruption detected
- ✗ Application crashes
- ✗ Manual intervention required for recovery
- ✗ Rate limiting broken (either no limiting or blocking legitimate users)

## Issues to File

For each feature that fails ungracefully, file a follow-up issue:

```markdown
## Redis Failover Impact: [Feature]

### Problem
During Redis primary failure, [feature] failed with: [description]

### Impact
- [User-facing impact]
- [Data loss risk]
- [Recovery time]

### Reproduction
1. Stop Redis primary
2. Wait 5 minutes
3. Observe [behavior]
4. Restart Redis
5. Verify recovery

### Acceptance Criteria
- [ ] Feature fails gracefully during outage
- [ ] No data loss
- [ ] Automatic recovery on Redis restart
- [ ] Users not impacted (or minimal impact)
```

## Example: Caching Graceful Degradation

Expected behavior:
```
Redis fails → Cache miss → Fall back to database → Slightly slower response → Success
```

Ungraceful behavior (file issue):
```
Redis fails → Cache miss → Application crash → User error page
```

## Related Documentation

- [Redis Setup and Configuration](../redis-setup.md)
- [Monitoring and Alerting](../monitoring.md)
- [Application Error Handling](../error-handling.md)
- [Queue Processing and Retries](../queue-processing.md)
- [Rate Limiting Strategy](../rate-limiting.md)

## Appendix: Automated Drill Script

```bash
#!/bin/bash
# scripts/redis-failover-drill.sh

set -e

ENVIRONMENT=${1:-staging}
DURATION_SECS=${2:-300}  # 5 minutes default

echo "Starting Redis failover drill in $ENVIRONMENT..."

# Phase 1: Baseline
echo "Collecting baseline metrics..."
redis-cli -h $ENVIRONMENT-redis INFO > /tmp/redis_baseline.txt

# Phase 2: Stop Redis
echo "Stopping Redis primary..."
docker stop redis-primary  # or appropriate stop command

# Load test while Redis is down
npm run load-test -- --duration 5m &

sleep $DURATION_SECS

# Phase 3: Restart Redis
echo "Restarting Redis primary..."
docker start redis-primary

sleep 30  # Wait for startup

# Phase 4: Analysis
echo "Collecting final metrics..."
npm run analyze-redis-drill

echo "Drill complete. Review: /tmp/redis_drill_report.html"
```
