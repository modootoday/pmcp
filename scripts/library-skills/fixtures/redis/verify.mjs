import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createConnectionProxy } from "./connection-proxy.mjs";
import { bounded, closeRedis, deferred } from "./lifecycle.mjs";

function isolatedEndpoint(value) {
  assert.ok(
    value,
    "Pass redisUrl or PMCP_SKILL_REDIS_URL for an isolated test service",
  );
  const endpoint = new URL(value);
  assert.equal(endpoint.protocol, "redis:");
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname),
    "Only explicit loopback test endpoints are permitted",
  );
  assert.ok(endpoint.port, "An explicit isolated service port is required");
  assert.equal(endpoint.search, "");
  assert.match(endpoint.pathname, /^(?:\/\d*)?$/u);
  return endpoint;
}

export async function verify({
  scratchRoot,
  redisUrl = process.env.PMCP_SKILL_REDIS_URL,
}) {
  assert.ok(scratchRoot, "Pass an isolated dependency workspace path");
  const endpoint = isolatedEndpoint(redisUrl);
  const root = resolve(scratchRoot);
  const require = createRequire(join(root, "package.json"));
  const Redis = require("ioredis");
  const { Queue, QueueEvents, Worker } = require("bullmq");
  const packages = {
    ioredis: require("ioredis/package.json").version,
    bullmq: require("bullmq/package.json").version,
  };
  assert.deepEqual(packages, { ioredis: "5.11.1", bullmq: "5.81.4" });
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "redis-"));
  const prefix = `pmcp-verify-${randomUUID().replaceAll("-", "")}`;
  const keys = [`${prefix}:value`, `${prefix}:count`, `${prefix}:wrong-type`];
  const connectionOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  };
  const producer = new Redis(endpoint.href, connectionOptions);
  const subscriber = new Redis(endpoint.href, connectionOptions);
  const checks = [];
  const clientErrors = [];
  producer.on("error", (error) => clientErrors.push(error.message));
  subscriber.on("error", (error) => clientErrors.push(error.message));
  let proxy;
  let workerConnection;
  let queue;
  let events;
  let worker;
  let failFast;
  const release = deferred();
  try {
    await bounded(
      Promise.all([producer.connect(), subscriber.connect()]),
      "Redis connections",
    );
    assert.equal(await producer.ping(), "PONG");
    await producer.set(keys[0], "first");
    assert.equal(await producer.get(keys[0]), "first");
    checks.push("ioredis ready connection and key round-trip");
    const results = await producer
      .pipeline()
      .set(keys[1], "1")
      .incr(keys[1])
      .get(keys[1])
      .exec();
    assert.deepEqual(results, [
      [null, "OK"],
      [null, 2],
      [null, "2"],
    ]);
    await producer.set(keys[2], "text");
    const failedPipeline = await producer
      .pipeline()
      .lpush(keys[2], "value")
      .get(keys[2])
      .exec();
    assert.match(failedPipeline[0][0].message, /WRONGTYPE/u);
    assert.equal(failedPipeline[1][1], "text");
    checks.push("pipeline per-command successes and errors remain visible");
    assert.deepEqual(
      await producer.multi().set(keys[1], "4").incr(keys[1]).exec(),
      [
        [null, "OK"],
        [null, 5],
      ],
    );
    checks.push("transaction command results");
    const received = deferred();
    const channel = `${prefix}:events`;
    subscriber.on("message", (name, message) => {
      if (name === channel) received.resolve(message);
    });
    await subscriber.subscribe(channel);
    assert.equal(await producer.publish(channel, "ready"), 1);
    assert.equal(await bounded(received.promise, "Pub/Sub delivery"), "ready");
    await subscriber.unsubscribe(channel);
    checks.push("separate subscriber connection and awaited subscription");
    assert.deepEqual(clientErrors, []);
    proxy = await createConnectionProxy(endpoint);
    workerConnection = new Redis(proxy.url, {
      maxRetriesPerRequest: null,
      connectTimeout: 2000,
      retryStrategy: () => 100,
    });
    workerConnection.on("error", (error) => clientErrors.push(error.message));
    queue = new Queue("jobs", { connection: producer, prefix });
    events = new QueueEvents("jobs", {
      connection: {
        host: endpoint.hostname.replace(/^\[|\]$/gu, ""),
        port: Number(endpoint.port),
        username: endpoint.username || undefined,
        password: endpoint.password || undefined,
        db: Number(endpoint.pathname.slice(1) || 0),
        maxRetriesPerRequest: null,
      },
      prefix,
    });
    events.on("error", (error) => clientErrors.push(error.message));
    const active = deferred();
    worker = new Worker(
      "jobs",
      async (job) => {
        if (job.name === "retry" && job.attemptsMade === 0)
          throw new Error("fixture-transient-error");
        if (job.name === "failure") throw new Error("fixture-permanent-error");
        if (job.name === "active") {
          active.resolve();
          await release.promise;
        }
        return job.data.value * 2;
      },
      { connection: workerConnection, prefix, concurrency: 1 },
    );
    worker.on("error", (error) => clientErrors.push(error.message));
    await bounded(
      Promise.all([events.waitUntilReady(), worker.waitUntilReady()]),
      "BullMQ readiness",
    );
    const completed = await queue.add("success", { value: 3 });
    assert.equal(await completed.waitUntilFinished(events, 10_000), 6);
    assert.equal(await completed.getState(), "completed");
    checks.push("single BullMQ worker completes a real job");
    const retried = await queue.add(
      "retry",
      { value: 4 },
      { attempts: 2, backoff: { type: "fixed", delay: 50 } },
    );
    assert.equal(await retried.waitUntilFinished(events, 10_000), 8);
    const refreshed = await queue.getJob(retried.id);
    assert.equal(refreshed.attemptsMade, 2);
    checks.push("transient failure retries within configured attempts");
    const failed = await queue.add("failure", { value: 5 }, { attempts: 1 });
    await assert.rejects(
      failed.waitUntilFinished(events, 10_000),
      /fixture-permanent-error/u,
    );
    assert.equal(await failed.getState(), "failed");
    checks.push(
      "permanent failure is distinguished from successful completion",
    );
    proxy.suspend();
    failFast = new Redis(proxy.url, {
      ...connectionOptions,
      retryStrategy: () => null,
    });
    failFast.on("error", (error) => clientErrors.push(error.message));
    await assert.rejects(
      bounded(failFast.connect(), "unavailable producer connect", 3000),
    );
    await assert.rejects(failFast.set(`${prefix}:unused`, "blocked"));
    checks.push("bounded fail-fast producer rejects disconnected writes");
    const recoveryJob = await queue.add("recovery", { value: 6 });
    await delay(150);
    assert.notEqual(await recoveryJob.getState(), "completed");
    proxy.resume();
    assert.equal(await recoveryJob.waitUntilFinished(events, 10_000), 12);
    checks.push("worker reconnects after isolated TCP interruption");
    const activeJob = await queue.add("active", { value: 7 });
    const finished = activeJob.waitUntilFinished(events, 10_000);
    await bounded(active.promise, "active job starts");
    let closed = false;
    const closing = worker.close().then(() => {
      closed = true;
    });
    await delay(50);
    assert.equal(closed, false);
    release.resolve();
    assert.equal(await finished, 14);
    await bounded(closing, "graceful worker close");
    assert.equal(closed, true);
    checks.push("graceful worker close waits for active job completion");
    await writeFile(
      join(directory, "observed-network-errors.json"),
      JSON.stringify(clientErrors),
    );
    return {
      productId: "ioredis",
      companionProductIds: ["bullmq"],
      verifiedOn: new Date().toISOString().slice(0, 10),
      verifiedVersions: [packages.ioredis],
      packages,
      examplesExecuted: checks.length,
      checks,
      environment: `Node ${process.versions.node}; explicit isolated Redis endpoint; concurrency 1`,
      evidenceDirectory: directory,
    };
  } finally {
    release.resolve();
    const cleanupErrors = [];
    const actions = [
      () => worker && bounded(worker.close(true), "worker cleanup"),
      () =>
        queue &&
        bounded(queue.obliterate({ force: true }), "owned queue cleanup"),
      () => events && bounded(events.close(), "QueueEvents close"),
      () => queue && bounded(queue.close(), "Queue close"),
      () => producer.status === "ready" && producer.del(...keys),
      ...[failFast, workerConnection, subscriber, producer].map(
        (client) => () => closeRedis(client),
      ),
      () => proxy && proxy.close(),
    ];
    for (const cleanup of actions) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        cleanupErrors,
        "Owned Redis fixture cleanup failed",
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await verify({
    scratchRoot: process.argv[2],
    redisUrl: process.argv[3],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
