import assert from "node:assert/strict";
import { bounded, deferred } from "../lifecycle.mjs";
export async function verifyKeyOperations({
  producer,
  subscriber,
  keys,
  prefix,
  checks,
  clientErrors,
}) {
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
}
