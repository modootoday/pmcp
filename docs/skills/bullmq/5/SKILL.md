---
name: bullmq
description: Use BullMQ 5 to produce Redis-backed jobs, run workers, distinguish completion/retry/permanent failure and close workers gracefully. Use for queue workflows with explicit connection ownership and idempotent side effects without adopting other-major APIs.
---

# BullMQ 5

Inspect the installed versions, queues, prefixes, Redis topology and worker lifecycle first. This line targets BullMQ 5.81.4 with ioredis 5.11.1. Preserve project concurrency, retention and retry policy.

## Produce and consume

Use matching queue names and prefixes for `Queue`, `Worker` and `QueueEvents`. Request producers need bounded failure; worker connections need `maxRetriesPerRequest: null`. `QueueEvents` needs its own blocking connection; do not share a Pub/Sub connection.

```ts
import type Redis from "ioredis";
import { Queue, Worker } from "bullmq";

export function createWorkflow(
  producer: Redis,
  workerConnection: Redis,
  prefix: string,
) {
  const queue = new Queue("jobs", { connection: producer, prefix });
  const worker = new Worker(
    "jobs",
    async (job) => {
      if (typeof job.data.value !== "number") throw new Error("Invalid value");
      return job.data.value * 2;
    },
    { connection: workerConnection, prefix, concurrency: 1 },
  );
  return { queue, worker };
}
```

The caller must create `workerConnection` with `maxRetriesPerRequest: null`, register operational error listeners and own shutdown. Add jobs with `queue.add(name, data, { attempts, backoff })`; TypeScript job types do not validate incoming JSON.

## Verify state

Wait for worker and `QueueEvents` readiness. In bounded integration tests, use `job.waitUntilFinished(queueEvents, timeout)` and check stored state. A return value and `completed` state differ from a rejected waiter and `failed` state.

Use a transient failure that succeeds on a configured later attempt and a permanent failure that exhausts attempts. Inspect `attemptsMade` on a refreshed job, not a stale object. An error event is not a completed job.

Retries and stalled recovery can execute work more than once. Make side effects idempotent. `jobId` deduplicates additions only while that job exists; removing a completed job permits reuse. Job IDs do not establish exactly-once delivery.

## Own shutdown

`await worker.close()` stops taking jobs and waits for active work. It has no overall deadline; the host must bound shutdown and choose a forced-stop policy. Close workers, queue event consumers, queues and finally caller-owned Redis clients. A queue does not own an independently supplied ioredis client.

Tests need a unique prefix and cleanup of only their queue after workers stop. Never obliterate an application queue as fixture setup. Review Redis `noeviction` with the service owner instead of modifying shared configuration from a helper.

The fixture targets one worker, concurrency 1, completion, retry, permanent failure, a network interruption and graceful close during active work. It does not establish production stalled-job recovery, multiple-worker coordination, repeatable scheduling, Cluster/Sentinel or BullMQ Pro behavior.

## Primary sources

- [Connections](https://docs.bullmq.io/guide/connections)
- [Graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown)
- [Production guidance](https://docs.bullmq.io/guide/going-to-production)
- [Upstream](https://github.com/taskforcesh/bullmq)
