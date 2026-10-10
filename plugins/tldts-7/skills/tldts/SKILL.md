---
name: tldts
description: Use tldts ^7.0.0 to parse hostnames, domains, public suffixes, and subdomains from URLs or host-like strings.
---

Verified against tldts@7.4.12 on 2026-09-08. 2 of 2 examples executed.

# tldts

Use the v7 function-oriented API. Import named functions from `tldts`:

```ts pmcp-example
import assert from 'node:assert/strict';
import {
  parse,
  getHostname,
  getDomain,
  getFullDomain,
  getPublicSuffix,
  getSubdomain,
  getDomainWithoutSuffix,
} from 'tldts';

const parsed = parse('http://www.writethedocs.org/conf/eu/2017/');
assert.equal(parsed.domain, 'writethedocs.org');
assert.equal(parsed.domainWithoutSuffix, 'writethedocs');
assert.equal(parsed.hostname, 'www.writethedocs.org');
assert.equal(parsed.isIcann, true);
assert.equal(parsed.isIp, false);
assert.equal(parsed.isPrivate, false);
assert.equal(parsed.publicSuffix, 'org');
assert.equal(parsed.subdomain, 'www');

assert.equal(
  getHostname('https://user:password@example.co.uk:8080/some/path?and&query#hash'),
  'example.co.uk',
);
assert.equal(getDomain('foo.google.co.uk'), 'google.co.uk');
assert.equal(getFullDomain('foo.google.co.uk'), 'foo.google.co.uk');
assert.equal(getPublicSuffix('google.co.uk'), 'co.uk');
assert.equal(getSubdomain('moar.foo.google.co.uk'), 'moar.foo');
assert.equal(getDomainWithoutSuffix('foo.google.co.uk'), 'google');
assert.equal(getFullDomain('1.2.3.4'), null);
```

`parse(url, options?)` returns parsed hostname information including `hostname`, `domain`, `domainWithoutSuffix`, `publicSuffix`, `subdomain`, `isIcann`, `isPrivate`, and `isIp`. The helper functions accept the same URL-or-host-like string and optional options. String-returning helpers return `string | null`.

Use `getFullDomain` when you want the complete non-IP domain. It returns `null` for an IP address. The older/common API shape remains function-based: code using `parse`, `getHostname`, `getDomain`, `getPublicSuffix`, `getSubdomain`, and `getDomainWithoutSuffix` is still the right general shape. v7 also documents `getFullDomain`.

## Private suffixes

ICANN domains are enabled by default, while private suffixes are not. Pass `allowPrivateDomains: true` when private suffixes should participate:

```ts pmcp-example
import assert from 'node:assert/strict';
import { parse, getPublicSuffix, getDomain } from 'tldts';

const defaultResult = parse('spark-public.s3.amazonaws.com');
assert.equal(defaultResult.domain, 'amazonaws.com');
assert.equal(defaultResult.isPrivate, false);

const privateResult = parse('spark-public.s3.amazonaws.com', {
  allowPrivateDomains: true,
});
assert.equal(privateResult.domain, 'spark-public.s3.amazonaws.com');
assert.equal(privateResult.domainWithoutSuffix, 'spark-public');
assert.equal(privateResult.hostname, 'spark-public.s3.amazonaws.com');
assert.equal(privateResult.isIcann, false);
assert.equal(privateResult.isIp, false);
assert.equal(privateResult.isPrivate, true);
assert.equal(privateResult.publicSuffix, 's3.amazonaws.com');
assert.equal(privateResult.subdomain, '');

assert.equal(
  getPublicSuffix('s3.amazonaws.com', { allowPrivateDomains: true }),
  's3.amazonaws.com',
);
assert.equal(
  getDomain('spark-public.s3.amazonaws.com', { allowPrivateDomains: true }),
  'spark-public.s3.amazonaws.com',
);
```

Do not assume PSL-style private-suffix results are implicit. Without `allowPrivateDomains: true`, the private suffix is ignored; with it, `s3.amazonaws.com` is treated as the public suffix in the example above.

## Options and the v7 validation change

The documented options are:

- `allowIcannDomains` — defaults to `true`.
- `allowPrivateDomains` — defaults to `false`.
- `extractHostname` — defaults to `true`.
- `validateHostname` — defaults to `true`.
- `detectIp`
- `mixedInputs`
- `validHosts`
- `detectSpecialUse`

In v7, hostname validation is consistent between `getHostname` and `parse(url).hostname`. With validation enabled, an invalid hostname stops processing and produces `null` as described by the v7 change. Set `validateHostname: false` to restore permissive parsing and allow processing to continue for inputs the validator would reject:

```ts
const result = parse(input, { validateHostname: false });
```

Do not carry forward pre-v7 assumptions that `getHostname` and `parse(...).hostname` can differ for invalid hostnames.

## CLI boundary

The package also has a CLI, but it is not a plain function call. Invoke it through the package runner or an installed executable, for example:

```sh
npx tldts 'http://www.writethedocs.org/conf/eu/2017/'
echo 'https://example.com' | npx tldts
```

Programmatic parsing does not require the CLI, a build step, or a package-owned runner.

## Does not cover

This skill does not cover the detailed semantics of every documented option (`allowIcannDomains`, `extractHostname`, `detectIp`, `mixedInputs`, `validHosts`, or `detectSpecialUse`), the complete hostname-validation rule set, the full CLI option set, or the package's suffix database beyond the examples shown. The research does not establish additional return-shape edge cases for malformed inputs, localhost, or other special-use names.
