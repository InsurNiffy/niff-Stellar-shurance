# Blue-Green Backend Deployment Runbook

## Overview

This runbook describes a zero-downtime blue-green deployment strategy for the NestJS backend service. The strategy involves running two production environments (blue and green) and switching traffic between them to eliminate downtime during deployments.

## Architecture

- **Blue Environment**: Current production environment serving live traffic
- **Green Environment**: Standby environment for new deployments
- **Load Balancer**: Routes traffic between blue and green based on health checks
- **Health Checks**: Gate traffic cutover to ensure only healthy versions receive requests

## Pre-Deployment Checklist

- [ ] All tests pass in CI/CD pipeline
- [ ] Database migrations are backward compatible or scheduled separately
- [ ] Deployment package built and verified
- [ ] Health check endpoint is working on the new version
- [ ] Monitoring and alerting configured
- [ ] On-call engineer available for rollback if needed
- [ ] Stakeholders notified of deployment window

## Deployment Steps

### Phase 1: Deploy to Green Environment

1. **Prepare green environment**
   ```bash
   # Stop green environment if running
   docker-compose -f docker-compose.prod.yml down -v

   # Deploy new version to green
   docker-compose -f docker-compose.prod.yml up -d --build
   ```

2. **Run database migrations** (if needed)
   ```bash
   docker-compose -f docker-compose.prod.yml exec backend npm run prisma:migrate:deploy
   ```

3. **Verify green environment is healthy**
   ```bash
   # Check health endpoint
   curl -f http://localhost:3001/health

   # Monitor logs for errors
   docker-compose -f docker-compose.prod.yml logs -f backend

   # Run smoke tests
   npm run test:smoke -- --env=green
   ```

### Phase 2: Health Check and Traffic Cutover

1. **Verify health checks pass**
   - Load balancer continuously checks health endpoints for both blue and green
   - Green must pass health checks for at least 30 seconds before cutover
   - If health check fails, automatic rollback (see Rollback section)

2. **Switch traffic to green**
   ```bash
   # Update load balancer configuration to route to green
   # This can be done via:
   # - Environment variable update + signal to reload
   # - API call to load balancer
   # - DNS switch (if using DNS-based routing)

   docker exec load-balancer /update-config.sh --primary=green --secondary=blue
   ```

3. **Monitor traffic and metrics**
   - Watch request latency and error rates on new version
   - Check application-level metrics (database connections, cache hit rates, etc.)
   - Set 5-minute monitoring window for any issues
   - If issues detected, proceed to rollback immediately

### Phase 3: Validate Deployment

1. **Run end-to-end tests**
   ```bash
   npm run test:e2e -- --env=production
   ```

2. **Check key metrics**
   - Request latency p50, p95, p99
   - Error rate
   - Database connection pool usage
   - Cache hit rates
   - Redis connection status

3. **Confirm no issues in blue environment**
   - Keep blue running for 10 minutes as fallback
   - Monitor for any traffic anomalies

## Rollback Steps

### Automatic Rollback (Health Check Failure)

If green fails health checks, the load balancer will automatically:
1. Stop routing traffic to green
2. Continue serving traffic from blue
3. Alert on-call engineer
4. Log rollback event for analysis

### Manual Rollback

If issues are discovered after cutover:

1. **Switch traffic back to blue**
   ```bash
   docker exec load-balancer /update-config.sh --primary=blue --secondary=green
   ```

2. **Verify blue is serving traffic**
   ```bash
   curl -f http://production-lb/health
   ```

3. **Investigate issue**
   - Collect logs from green environment
   - Review application metrics at time of failure
   - Determine if issue is code-related or infrastructure-related

4. **Document findings**
   - File incident report
   - Create follow-up issues for any bugs found
   - Update runbook if procedure needs adjustment

5. **Prepare for re-deployment**
   - Fix issue in code or configuration
   - Test thoroughly in green environment again
   - Schedule retry deployment

## Post-Deployment

- [ ] Deployment marked as complete in tracking system
- [ ] Success notification sent to team
- [ ] Metrics baseline updated for monitoring
- [ ] Green environment logs archived
- [ ] Blue environment ready for next deployment

## Monitoring and Alerts

### Key Metrics to Monitor

- Application response times (p50, p95, p99)
- Error rates (5xx, 4xx, specific error types)
- Database connection pool status
- Redis connection status and latency
- Memory and CPU usage
- Request queue depths

### Alert Thresholds

- Error rate > 1%: Warning
- Error rate > 5%: Critical (trigger rollback)
- Latency p95 > 500ms: Warning
- Latency p99 > 1000ms: Critical

## Troubleshooting

### Health checks failing on new version

1. Check logs: `docker-compose -f docker-compose.prod.yml logs backend`
2. Verify database connectivity: `npm run db:check`
3. Verify Redis connectivity: `npm run redis:check`
4. Verify all environment variables are set correctly
5. If unrecoverable, trigger rollback and investigate

### Traffic not switching

1. Verify load balancer is running: `docker ps | grep load-balancer`
2. Check load balancer logs: `docker logs load-balancer`
3. Verify green environment has active connections
4. Manually restart load balancer if necessary: `docker restart load-balancer`

### High latency after cutover

1. Check if database connections are exhausted
2. Check Redis connection status
3. Look for lock contention in application logs
4. Check if background jobs are running properly
5. If issue persists > 1 minute, trigger rollback

## Related Documentation

- [Health Check Endpoint Documentation](../health-checks.md)
- [Database Migration Rollback Drill](./migration-rollback-drill.md)
- [Monitoring Setup](../monitoring.md)
- [Incident Response](../incidents.md)
