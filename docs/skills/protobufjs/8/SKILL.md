---
name: protobufjs
description: Use protobufjs ^8.0.0 for runtime protobuf reflection, schema loading, message conversion, and binary encoding/decoding. Prefer the ordinary reflection API unless generated code is supplied by protobufjs-cli.
---

Verified against protobufjs@8.8.0 on 2026-09-08. 2 of 2 examples executed.

# protobufjs ^8.0.0

## What this package provides

`protobufjs` is the full runtime package: static code, reflection, and `.proto` parsing. Its documented variants are:

- `protobufjs`: static code, reflection, and `.proto` parsing
- `protobufjs/light`: static code and reflection
- `protobufjs/minimal`: static code only

The package exposes reflection constructors and types including `Root`, `Type`, `Field`, `Message`, `Enum`, `Service`, `Method`, `OneOf`, and `Namespace`. It also exposes `Reader`, `Writer`, and the `converter`, `rpc`, `types`, and `util` namespaces.

## Common runtime workflow

The usual reflection workflow is:

```js
const root = await protobuf.load("awesome.proto");
const AwesomeMessage = root.lookupType("awesomepackage.AwesomeMessage");
```

`load()` accepts either a promise-based or callback-based use. `loadSync()` is documented for synchronous Node.js loading. A `.proto` field name is converted to camelCase by default; use `keepCase` when the original spelling must be retained.

In a standalone script, loading a file is not demonstrated here because examples are run without a filesystem. The programmatic reflection API is useful when the schema can be built in memory.

## Build a schema with reflection

Create a `Type`, add `Field` objects, put the type in a `Root`, and look it up by its fully qualified name:

```ts pmcp-example
import assert from "node:assert/strict";
import protobuf from "protobufjs";

const AwesomeMessage = new protobuf.Type("AwesomeMessage")
  .add(new protobuf.Field("awesomeField", 1, "string"));

const root = new protobuf.Root()
  .define("awesomepackage")
  .add(AwesomeMessage);

const MessageType = root.lookupType("awesomepackage.AwesomeMessage");
assert.equal(MessageType, AwesomeMessage);

const message = MessageType.create({ awesomeField: "hello" });
assert.equal(message.awesomeField, "hello");
```

## Message lifecycle and binary encoding

The documented message operations are:

- `create(properties)` creates a message instance.
- `verify(object)` returns `null` for a valid object or an error string.
- `fromObject(object)` converts a plain object to a message.
- `toObject(message, options?)` converts a message to a plain object.
- `encode(message)` and `encodeDelimited(message)` return a `Writer`.
- Call `.finish()` on the writer to obtain encoded bytes.
- `decode(bytesOrReader)` and `decodeDelimited(bytesOrReader)` decode messages.

Use `create()` for the ordinary runtime path. Do not assume a generated message type should be called with `new`; the documented reflection usage is `MessageType.create(...)`.

```ts pmcp-example
import assert from "node:assert/strict";
import protobuf from "protobufjs";

const MessageType = new protobuf.Type("Greeting")
  .add(new protobuf.Field("text", 1, "string"));

const message = MessageType.create({ text: "hello" });
assert.equal(MessageType.verify(message), null);

const encoded = MessageType.encode(message).finish();
const decoded = MessageType.decode(encoded);
assert.equal(decoded.text, "hello");

const plain = MessageType.toObject(decoded);
assert.equal(plain.text, "hello");

const converted = MessageType.fromObject({ text: "again" });
assert.equal(converted.text, "again");

const delimited = MessageType.encodeDelimited(message).finish();
const decodedDelimited = MessageType.decodeDelimited(delimited);
assert.equal(decodedDelimited.text, "hello");
```

## Generated code and the CLI

The runtime package alone does not provide the `pbjs` code-generation command. Generation requires `protobufjs-cli` (or `protoc-gen-pbjs`), for example:

```sh
npm install --save-dev protobufjs-cli
npx pbjs -t static-module -w commonjs -o compiled.js --dts file1.proto file2.proto
npx pbjs -t json-module -w commonjs -o bundle.js --dts file1.proto file2.proto
```

`static-module` output is reflection-free and uses `protobufjs/minimal.js`. `json-module` output is reflection-backed and uses `protobufjs/light.js`. Generated modules are then consumed as ordinary imports.

The CLI documentation describes static-module output as non-functional on its own. Do not expect installing only `protobufjs` to provide the CLI or code generation.

## Services

The documented service-client entry point is `MyService.create(rpcImpl, requestDelimited?, responseDelimited?)`. The RPC implementation receives `(method, requestData, callback)` and must eventually invoke the callback with either an error or response bytes:

```js
function myRpcImpl(method, requestData, callback) {
  performRequest(requestData, function (err, responseData) {
    callback(err, responseData);
  });
}
```

The service client requires a service definition and an RPC transport implementation; this skill does not provide a standalone service example because the supplied research does not document enough of the service-definition construction API to make one safely runnable without inventing details.

## Version-specific caution

The `^8.0.0` range permits current 8.x releases; the researched npm page lists 8.8.0. The documented v8.0.0 breaking change is Edition 2024 support. Edition 2023 was added in v7.5.0. Be cautious when copying older examples: ordinary reflection loading and `Type.create(...)` remain the documented shape, but edition support is part of the v8 runtime.

## Not covered

This skill does not cover the exact `.proto` schema syntax, descriptor conversion, ProtoJSON, Text Format, every reflection constructor, generated-module APIs in detail, CLI options beyond the shown commands, `protoc-gen-pbjs`, or the complete service-definition and transport setup. Those areas require documentation or tooling details not present in the supplied research.
