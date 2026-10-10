---
name: ip-address
description: Use ip-address ^10.0.0 for standalone IPv4 and IPv6 parsing, validation, subnet checks, conversions, special-address inspection, and URL parsing. This skill emphasizes the v10 native-BigInt API and avoids older v9 method names.
---

Verified against ip-address@10.7.0 on 2026-09-08. 8 of 8 examples executed.

# ip-address ^10.0.0

`ip-address` 10.x exports `Address4`, `Address6`, and `AddressError`. It supports ESM and CommonJS and includes TypeScript declarations. The documented runtime requires Node.js 12 or newer. Install it before running the examples.

## Importing

Use the named ESM exports:

```ts pmcp-example
import { strict as assert } from 'node:assert/strict';
import { Address4, Address6 } from 'ip-address';

assert.equal(Address4.isValid('192.168.1.1'), true);
assert.equal(Address6.isValid('2001:db8::1'), true);
assert.equal(Address6.isValid('not an address'), false);

const v4 = new Address4('192.168.1.1/24');
const v6 = new Address6('2001:db8::1/64');

assert.ok(v4);
assert.ok(v6);
```

CommonJS is also documented:

```js
const { Address6 } = require('ip-address');
const address = new Address6('2001:0:ce49:7601:e866:efff:62c3:fffe');
const teredo = address.inspectTeredo();
console.log(teredo.client4);
```

## IPv4

Construct an address with an optional CIDR prefix. `isValid` is a static validity check. IPv4 addresses support subnet membership, subnet boundaries, private/global checks, and alternate constructors.

```ts pmcp-example
import { strict as assert } from 'node:assert/strict';
import { Address4 } from 'ip-address';

const host = new Address4('192.168.1.42');
const network = new Address4('192.168.1.0/24');

assert.equal(host.isInSubnet(network), true);
assert.equal(network.startAddress().correctForm(), '192.168.1.0');
assert.equal(network.endAddress().correctForm(), '192.168.1.255');
assert.equal(new Address4('192.168.1.1').isPrivate(), true);
assert.equal(typeof new Address4('192.168.1.1').isGlobal(), 'boolean');
```

Available IPv4 constructors and checks include:

- `new Address4(address)`
- `Address4.isValid(address)`
- `Address4.fromAddressAndMask(address, mask)`
- `Address4.fromAddressAndWildcardMask(address, wildcardMask)`
- `Address4.fromWildcard(input)`
- `Address4.fromHex(hex)`
- `Address4.fromInteger(integer)`
- `isInSubnet(subnet)`
- `startAddress()` and `endAddress()`
- `isPrivate()` and `isGlobal()`
- `correctForm()`

The alternate constructors return `Address4` instances. `fromWildcard` takes a four-octet wildcard pattern; use `*` for wildcard octets.

```ts pmcp-example
import { strict as assert } from 'node:assert/strict';
import { Address4 } from 'ip-address';

const fromMask = Address4.fromAddressAndMask('192.168.1.42', '255.255.255.0');
const fromWildcardMask = Address4.fromAddressAndWildcardMask('192.168.1.42', '0.0.0.255');
const fromWildcard = Address4.fromWildcard('192.168.*.*');
const fromHex = Address4.fromHex('c0a80101');
const fromInteger = Address4.fromInteger(3232235777);

for (const address of [fromMask, fromWildcardMask, fromWildcard, fromHex, fromInteger]) {
  assert.ok(address instanceof Address4);
}
```

## IPv6

Construct an IPv6 address with an optional CIDR prefix and optionally an `optionalGroups` value. IPv6 provides canonical and native-BigInt forms, byte conversion, special-address predicates, embedded IPv4 handling, URL parsing, and protocol-specific inspection.

```ts pmcp-example
import { strict as assert } from 'node:assert/strict';
import { Address6 } from 'ip-address';

const address = new Address6('2001:db8::1/64');
assert.equal(address.canonicalForm(), '2001:0db8:0000:0000:0000:0000:0000:0001');
assert.equal(typeof address.bigInt(), 'bigint');
assert.equal(Array.isArray(address.toByteArray()), true);

const link = new Address6('fe80::1');
assert.equal(link.isLinkLocal(), true);
assert.equal(link.isMulticast(), false);
assert.equal(link.isLoopback(), false);
assert.equal(typeof link.isGlobal(), 'boolean');
```

The documented IPv6 surface includes:

- `new Address6(address, optionalGroups?)`
- `Address6.isValid(address)`
- `Address6.fromBigInt(bigInt)`
- `bigInt()`
- `canonicalForm()` and `toByteArray()`
- `isLinkLocal()`, `isMulticast()`, `isLoopback()`, and `isGlobal()`
- `inspectTeredo()` and `inspect6to4()`
- `toAddress4Nat64(prefix?)`
- `embeddedIPv4()`
- `href(optionalPort?)`
- `link(options?)`, where options may contain `className`, `prefix`, and `v4`

Use native `bigint` in v10:

```ts pmcp-example
import { strict as assert } from 'node:assert/strict';
import { Address6 } from 'ip-address';

const original = new Address6('2001:db8::1');
const numeric = original.bigInt();
const restored = Address6.fromBigInt(numeric);

assert.equal(typeof numeric, 'bigint');
assert.ok(restored instanceof Address6);
assert.equal(restored.canonicalForm(), original.canonicalForm());
```

Teredo addresses can expose the decoded client IPv4 address:

```ts pmcp-example
import { strict as assert } from 'node:assert/strict';
import { Address6 } from 'ip-address';

const teredo = new Address6('2001:0:ce49:7601:e866:efff:62c3:fffe');
assert.equal(teredo.inspectTeredo().client4, '157.60.0.1');
```

## IPv6 URLs and errors

`Address6.fromURL(url)` returns either an error result with `address: null` and `port: null`, or a result containing an `Address6` and a nullable port.

```ts pmcp-example
import { strict as assert } from 'node:assert/strict';
import { Address6 } from 'ip-address';

const parsed = Address6.fromURL('http://[2001:db8::1]:8080/');
assert.equal(parsed.port, 8080);
assert.ok(parsed.address instanceof Address6);
```

`AddressError` can be constructed with a message and an optional parse message; its `parseMessage` property is exposed.

```ts pmcp-example
import { strict as assert } from 'node:assert/strict';
import { AddressError } from 'ip-address';

const error = new AddressError('invalid address', 'parse failed');
assert.equal(error.parseMessage, 'parse failed');
assert.equal(error.message, 'invalid address');
```

## v10 migration warning

Do not copy the older v9 API names shown in older generated documentation:

- `fromBigInteger()` became `fromBigInt()`.
- `bigInteger()` became `bigInt()`.
- v10 returns and accepts native JavaScript `BigInt` values rather than the removed `jsbn`-based shape.

The package’s v10 generated documentation may still show `fromBigInteger` and `bigInteger`; follow the v10 migration names instead.

## What this skill does not cover

This skill does not cover browser bundling, the package’s build or release workflow, generated documentation, or command-line/tool execution. The research describes browser use through browserify but does not provide a standalone browser example. It also does not specify the exact results or input formats for every documented conversion, formatting, NAT64, 6to4, URL-error, or link option, so those details are left for the package’s TypeScript declarations or API documentation.
