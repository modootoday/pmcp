---
name: smol-toml
description: Read and serialize TOML configuration with smol-toml 1, including nested tables, parse diagnostics and explicit large-integer preservation. Use for TOML data workflows, not byte-preserving source editing or a schema validator.
---

# smol-toml 1 configuration data

Read the installed version before applying options from current upstream docs.
The fixture targets smol-toml 1.8.0; options introduced in 1.9 are outside that
verified version's contract.

## Parse, validate and serialize

```js
import { parse, stringify } from "smol-toml";

export function updateHost(source, host) {
  const settings = parse(source);
  if (!settings.service || typeof settings.service !== "object") {
    throw new Error("Missing service table");
  }
  settings.service.host = host;
  return stringify(settings);
}
```

Parse errors, including duplicate keys, should be reported rather than replaced
with empty defaults that lose the original configuration. Validate the parsed
object against the application's expected shape before using it.

stringify emits TOML data; it does not preserve comments or the original byte
layout. Do not promise a surgical source edit through parse→stringify. Functions,
symbols and arbitrary class instances are not ordinary TOML values.

## Preserve the intended value types

JavaScript numbers cannot represent all signed 64-bit TOML integers exactly.
Use integersAsBigInt when the consumer needs that range:

```js
const settings = parse("counter = 9223372036854775807", {
  integersAsBigInt: true,
});
```

BigInt affects the application's data contract and cannot be passed directly to
ordinary JSON.stringify. Preserve integers through TOML serialization or use an
explicit representation at a JSON boundary. Numbers with no decimal part may
serialize as integers, so a roundtrip is not a guarantee of original numeric
spelling.

TOML distinguishes offset datetimes, local datetimes, dates and times. Keep the
installed package's date representation and the consumer's interpretation
explicit; converting every value to a local JavaScript date changes semantics.

The fixture verifies nested data roundtrip, duplicate-key rejection and signed
64-bit integer preservation. It does not establish comment-preserving edits or
all datetime variants.

## Sources

- [smol-toml API, numeric limits and versioned options](https://github.com/squirrelchat/smol-toml)
- [TOML specification](https://toml.io/en/)
