# Backend Observability

This document covers queue observability for the BullMQ-based workers
(indexer and notification) and the manual job replay procedure.

## Bull Board dashboard

The Bull Board UI is mounted behind staff authentication at:

```
/admin/queues
```

Only authenticated staff (admin role) can access the dashboard. It exposes
queue depths, active/waiting/delayed counts, and the list of failed jobs for
each registered queue.

## Dead-letter queues

Each worker has a dedicated dead-letter queue (DLQ) that receives jobs after
they exhaust their retry budget:

| Worker       | Queue name              | DLQ name                     | Max retries |
| ------------ | ----------------------- | ---------------------------- | ----------- |
| Indexer      | `indexer`               | `indexer-dlq`                | 5           |
| Notification | `notification`          | `notification-dlq`           | 3           |

Max retry counts are documented here and configured on the worker `Queue`
options (`defaultJobOptions.attempts`). A job that fails `attempts` times is
moved to the corresponding DLQ instead of being silently dropped, so data
gaps are visible and recoverable.

## Prometheus metrics and alerting

A Prometheus gauge tracks dead-letter queue depth:

```
bullmq_dlq_depth{queue="indexer-dlq"}
bullmq_dlq_depth{queue="notification-dlq"}
```

Alert rule (fires when any DLQ exceeds the threshold):

```yaml
- alert: BullMqDeadLetterQueueDepthHigh
  expr: bullmq_dlq_depth > 10
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Dead-letter queue {{ $labels.queue }} depth is {{ $value }}"
    description: "Failed jobs are accumulating in a dead-letter queue. Investigate and replay."
```

To verify the alert in staging, inject a job configured to fail repeatedly
(e.g. a job whose handler always throws) and confirm it lands in the DLQ and
the alert fires once the threshold is crossed.

## Manual job replay procedure

1. Open the Bull Board dashboard at `/admin/queues` and select the affected
   DLQ (`indexer-dlq` or `notification-dlq`).
2. Inspect the failed job payload and error to confirm the root cause is
   resolved before replaying.
3. Retry the job from the dashboard ("Retry" action) or, for bulk replay,
   move jobs back to the source queue:

   ```ts
   // Pseudocode: move all DLQ jobs back to the source queue
   const jobs = await dlq.getJobs(['waiting', 'failed']);
   for (const job of jobs) {
     await sourceQueue.add(job.name, job.data, job.opts);
     await job.remove();
   }
   ```

4. Confirm the replayed jobs complete successfully and the DLQ depth gauge
   returns to zero.
5. Record the incident and replay in the on-call log.
