---
name: emittery
description: Use Emittery 2.x for asynchronous typed event emission, subscriptions, one-shot waits, async iterables, and listener lifecycle management.
---

Verified against emittery@2.0.0 on 2026-09-08. 9 of 9 examples executed.

# Emittery 2.x

## Version and runtime

This skill targets `emittery` `^2.0.0`. Emittery 2 requires Node.js 22. It works in browsers when bundled, but this skill's examples are standalone Bun scripts.

There is no package-specific runner or CLI documented here. Use the programmatic `Emittery` API.

## Critical v2 migration rule

Emittery 2 passes an event object to listeners, not the raw event data:

```ts
emitter.on('event', ({name, data}) => {
	// ...
});
```

This applies to `on`, `onAny`, `once` results, `events()`, and `anyEvent()`. Code written for v1 commonly still uses `data => ...`, `(eventName, eventData) => ...`, or `const data = await emitter.once(...)`; those shapes are incorrect in v2.

Emission is asynchronous. `emit()` runs listeners concurrently and must be awaited when ordering or errors matter. `emitSerial()` waits for each listener before invoking the next one.

## Basic subscription and removal

`on(eventName, listener, options?)` returns an unsubscribe function. The listener may be synchronous or asynchronous. `off(eventName, listener)` removes a listener explicitly. Both methods accept one event name or a readonly array of event names.

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const emitter = new Emittery();
const received: unknown[] = [];

const listener = ({name, data}: {name: string; data: unknown}) => {
	received.push([name, data]);
};

const off = emitter.on('message', listener);
await emitter.emit('message', 'hello');
off();
await emitter.emit('message', 'ignored');

assert.deepEqual(received, [['message', 'hello']]);
```

An `AbortSignal` can be supplied to `on`; aborting it removes the subscription.

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const emitter = new Emittery();
const controller = new AbortController();
let count = 0;

emitter.on('tick', () => {
	count++;
}, {signal: controller.signal});

await emitter.emit('tick');
controller.abort();
await emitter.emit('tick');

assert.equal(count, 1);
```

## One-shot listeners

`once(eventName, predicate?)` returns a promise resolving to the v2 event object. Destructure `{data}` rather than treating the resolved value as the data itself. The predicate also receives the event object.

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const emitter = new Emittery();
const result = emitter.once('data', ({data}: {name: string; data: {ok: boolean; value: number}}) => data.ok);

await emitter.emit('data', {ok: false, value: 1});
await emitter.emit('data', {ok: true, value: 2});

const {name, data} = await result;
assert.equal(name, 'data');
assert.deepEqual(data, {ok: true, value: 2});
```

## Concurrent and serial emission

`emit(name, data?)` invokes all matching listeners asynchronously and concurrently. If listeners reject, all listeners still run and the returned promise rejects with an `AggregateError`; listener errors are available as `error.errors`.

`emitSerial(name, data?)` waits between listeners, so use it when listener order or completion order is significant.

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const emitter = new Emittery();
const order: string[] = [];

emitter.on('event', async () => {
	order.push('first-start');
	await Promise.resolve();
	order.push('first-end');
});
emitter.on('event', () => {
	order.push('second');
});

await emitter.emitSerial('event');
assert.deepEqual(order, ['first-start', 'first-end', 'second']);
```

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const emitter = new Emittery();
let completed = 0;

emitter.on('event', () => {
	completed++;
});
emitter.on('event', async () => {
	throw new Error('listener failure');
});

await assert.rejects(
	emitter.emit('event'),
	(error: any) => error instanceof AggregateError
		&& Array.isArray(error.errors)
		&& error.errors.length === 1
		&& completed === 1,
);
```

## Async event streams

`events(eventName)` returns an async iterable for one event name. `anyEvent()` returns an async iterable of `{name, data}` for all events. Break the loop when the desired event has been received.

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const emitter = new Emittery();
const values: unknown[] = [];

const stream = emitter.events('message');
const consuming = (async () => {
	for await (const {data} of stream) {
		values.push(data);
		if (data === 'stop') {
			break;
		}
	}
})();

await emitter.emit('message', 'one');
await emitter.emit('message', 'stop');
await consuming;

assert.deepEqual(values, ['one', 'stop']);
```

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const emitter = new Emittery();
const seen: unknown[] = [];

const consuming = (async () => {
	for await (const {name, data} of emitter.anyEvent()) {
		seen.push([name, data]);
		break;
	}
})();

await emitter.emit('ready', 42);
await consuming;
assert.deepEqual(seen, [['ready', 42]]);
```

## Any-event listeners and listener inspection

`onAny(listener)` receives one `{name, data}` object. `offAny(listener)` removes it. `listenerCount(eventName?)` reports listeners associated with the event, including an `onAny` listener when an event name is supplied. `clearListeners(eventName?)` clears listeners.

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const emitter = new Emittery();
const seen: unknown[] = [];
const listener = ({name, data}: {name: string; data: unknown}) => {
	seen.push([name, data]);
};

emitter.onAny(listener);
assert.equal(emitter.listenerCount('event'), 1);
await emitter.emit('event', 1);
assert.deepEqual(seen, [['event', 1]]);

emitter.offAny(listener);
emitter.on('event', () => {});
assert.equal(emitter.listenerCount('event'), 1);
emitter.clearListeners('event');
assert.equal(emitter.listenerCount('event'), 0);
```

## Other documented API

The instance also exposes `init`, `logIfDebugEnabled`, and `bindMethods`. `bindMethods(object)` binds Emittery methods onto another object:

```ts pmcp-example
import Emittery from 'emittery';
import assert from 'node:assert/strict';

const object: Record<string, any> = {};
new Emittery().bindMethods(object);

assert.equal(typeof object.emit, 'function');
assert.equal(typeof object.on, 'function');
```

The type declarations export `EventName`, `EmitteryEvent`, `DebugLogger`, `DebugOptions`, `Options`, `EmitteryOncePromise`, `UnsubscribeFunction`, and `ListenerChangedData`. The default export is `Emittery`; its documented runtime static members include `isDebugEnabled`, `listenerAdded`, `listenerRemoved`, and `mixin`.

## Not covered

The research does not specify the signatures or behavior of `init`/`deinit`, debug configuration and logging, the static members, `mixin`, decorator support, disposable integrations, typed `AllEventData` declaration patterns, or the exact cancellation behavior of one-shot operations. Consult the package's v2 declarations and documentation before using those areas.
