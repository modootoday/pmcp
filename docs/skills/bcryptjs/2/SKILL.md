---
name: bcryptjs
description: Use bcryptjs 2.x for asynchronous password hashing and comparison, explicit UTF-8 input limits, stored work-factor inspection, and controlled rehash decisions without v3-only APIs.
compatibility: bcryptjs 2.4.3 in Node.js. The v2 package uses CommonJS and supports Promise-based hash and compare calls.
---

# bcryptjs 2.x

Use this skill for `bcryptjs` 2.x, especially the observed 2.4.3 release.
Inspect the installed version before using examples from the current upstream
branch. V2 does not provide the newer `bcrypt.truncates()` helper.

## Enforce the byte limit before hashing

Bcrypt accepts at most 72 input bytes. Count UTF-8 bytes, not JavaScript string
length; multibyte passwords can exceed the limit with fewer than 72 characters.
Reject an oversized input explicitly rather than silently accepting a truncated
password. Apply the same input policy before comparison.

```js
function validatePassword(password) {
  if (typeof password !== "string") {
    throw new TypeError("Password must be a string");
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new RangeError("Password exceeds bcrypt's 72-byte limit");
  }
  return password;
}
```

Keep minimum length, normalization and acceptance rules in the application's
password policy. Introducing a new preprocessing rule for existing hashes can
make the original password fail comparison; do not change that contract
silently during a library upgrade.

## Use async operations and preserve the encoded hash

```js
const bcrypt = require("bcryptjs");

async function createPasswordHash(password, workFactor) {
  return bcrypt.hash(validatePassword(password), workFactor);
}

async function passwordMatches(password, storedHash) {
  return bcrypt.compare(validatePassword(password), storedHash);
}
```

Pass a measured application work factor; omitting a callback selects the
Promise API. Passing a numeric work factor to `hash` generates a fresh random
salt. Store the complete encoded hash, which includes the salt and cost, and
compare with `bcrypt.compare` rather than hashing again and comparing strings.
Do not log plaintext passwords or substitute an insecure random fallback.

Async calls yield between portions of CPU work, but hashing still consumes CPU.
Bound concurrent login/hash operations and benchmark the actual deployment.
Cost 4 in a small local fixture reduces test time; it is not an operating
recommendation for password storage.

## Make rehash a verified-login decision

Read `bcrypt.getRounds(storedHash)` to inspect its cost. After a successful
comparison, the application can create a new hash if its current policy calls
for a higher cost, then persist it with normal concurrency safeguards. Do not
rehash a supplied password after a failed comparison, or downgrade a stronger
stored cost merely because the default changed.

Useful bounded checks are async hash/compare success and failure, encoded cost,
exactly 72 UTF-8 bytes, oversized ASCII/multibyte input and non-string input.
These checks establish local library behavior; they do not evaluate password
policy strength, authentication rate limits or database persistence.

## Sources

- [Pinned bcryptjs 2.4.3 usage and input limits](https://github.com/dcodeIO/bcrypt.js/blob/2.4.3/README.md)
- [Pinned v2 implementation](https://github.com/dcodeIO/bcrypt.js/blob/2.4.3/dist/bcrypt.js)
