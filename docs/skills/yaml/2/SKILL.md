---
name: yaml
description: Parse, diagnose and edit YAML configuration with yaml 2, preserving document comments when needed and controlling duplicate keys, schemas and alias expansion. Use the Document API for roundtrip edits rather than reconstructing commented files from plain objects.
---

# yaml 2 configuration workflows

Inspect the installed version, selected YAML schema and the configuration owner's
validation rules. The fixture targets yaml 2.9.0. The parser does not replace the
application's schema validation.

## Parse and report diagnostics

parse converts to plain values and throws on parse errors. parseDocument provides
the document tree and errors/warnings for a diagnostic workflow. Check errors
before consuming or writing that document; a returned object is not evidence of
a valid configuration.

```js
import { parseDocument } from "yaml";

export function updatePort(source, port) {
  const document = parseDocument(source);
  if (document.errors.length) throw document.errors[0];
  document.setIn(["service", "port"], port);
  return document.toString();
}
```

The Document API retains comments and structure where supported. Plain
parse→stringify regenerates representation and should not be used to promise
comment-preserving edits. Review the written diff when formatting or anchors
matter to the owner.

## Choose schema and conversion boundaries

YAML 1.2 is the default. YAML 1.1 has different scalar interpretation, so select
it only when the consumer requires it. Quote ambiguous scalar strings when their
intended type should be explicit.

Duplicate keys are errors by default. Do not disable that check to accept an
ambiguous configuration silently. Alias conversion is controlled by
maxAliasCount; zero disallows alias expansion, while a negative value disables
the limit. Keep the caller's intended bounded policy for untrusted inputs.

Validate the resulting plain object before applying it. Avoid merging user data
into global configuration with an unrestricted recursive merge merely because
the YAML syntax parsed. Custom schemas and tags need their own conversion tests.

The fixture verifies a commented document update, duplicate-key diagnostics and
alias-conversion limits. It does not validate arbitrary application schemas.

## Sources

- [yaml Document API, parsing options and diagnostics](https://eemeli.org/yaml/)
- [yaml source and package releases](https://github.com/eemeli/yaml)
