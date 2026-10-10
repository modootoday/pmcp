---
name: semver
description: Validate npm-style semantic versions and ranges using semver 7, including prerelease policy, zero-major compatibility, candidate selection and range intersection. Use for package compatibility logic rather than parsing arbitrary application identifiers.
---

# semver 7 package compatibility

Read the installed package and the caller's compatibility policy. The fixture
targets semver 7.8.5. Preserve the supplied range instead of widening it to make a
candidate pass.

## Validate before comparison

valid and validRange return null for invalid input. Distinguish a concrete version
from a range and handle failure explicitly. coerce extracts a version-like value;
it does not validate the original input and should not silently replace strict
validation in an installation or release boundary.

```js
import semver from "semver";

export function accepts(version, range) {
  if (!semver.valid(version)) return false;
  if (!semver.validRange(range)) return false;
  return semver.satisfies(version, range);
}
```

Use compare, gt or sort for semantic order, not string or numeric comparison.
Build metadata does not affect precedence; compareBuild has a separate purpose.

## Keep compatibility policy explicit

Caret ranges treat zero-major releases differently: ^0.3.0 permits 0.3.x but not
0.4.0. Do not model every caret range as accepting all releases below the next
major.

Prereleases are normally excluded from ordinary ranges. includePrerelease changes
that policy and must be intentional. A comparator containing a prerelease has its
own matching semantics; test the caller's actual range and candidate pair rather
than assuming all beta versions behave alike.

intersects checks whether ranges overlap. It does not prove that a specific
published version exists or identify a version installed in a project. Use
maxSatisfying only on a known candidate list; resolve actual installations from
the project's package manager evidence.

The fixture checks invalid versions, zero-major caret boundaries, explicit
prerelease inclusion and intersection. It does not query a registry or alter
dependencies.

## Sources

- [node-semver API and range semantics](https://github.com/npm/node-semver)
- [Semantic Versioning specification](https://semver.org/)
