---
name: firebase-admin
description: Practical firebase-admin ^14.0.0 guidance for Node.js 22+ server applications, using v14 modular imports and avoiding removed legacy APIs.
---

Verified against firebase-admin@14.3.0 on 2026-09-08. 4 of 4 examples executed.

# firebase-admin ^14.0.0

Use this skill for `firebase-admin` version `^14.0.0` in a Node.js 22+ server application. Firebase Admin SDK v14 requires Node.js 22 or newer; Node.js 18 and 20 are no longer supported.

## Use the modular API

Import each service from its documented module:

```ts
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
```

Do not use the older namespaced shape:

```ts
import * as admin from 'firebase-admin';
admin.initializeApp();
admin.auth();
```

The v13 namespaced API was retained temporarily but was documented for removal. v14 removes legacy namespace support. The deprecated Instance ID API was also removed; code using `admin.instanceId()` must be migrated to the supported Installations APIs.

## Initialize and retrieve apps

Import app functions from `firebase-admin/app`:

- `initializeApp(options?, appName?)` creates an app.
- `getApp(appName?)` retrieves an existing app.
- `getApps()` returns all initialized apps.

The default app has no name argument. A named app must be retrieved with the same name used during initialization.

In Google environments, default credentials are looked up automatically. `FIREBASE_CONFIG` may provide configuration for Realtime Database, Cloud Storage, or Cloud Functions. The SDK is intended for a server application with Firebase credentials and project setup.

```ts pmcp-example
import assert from 'node:assert/strict';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';

const app = initializeApp({ projectId: 'example-project' }, 'example-app');
assert.equal(getApp('example-app'), app);
assert.equal(getApps().includes(app), true);
assert.equal(app.name, 'example-app');
```

The example uses a local project ID only to exercise app initialization. Production code should configure appropriate credentials and project settings.

## Authentication

Use `getAuth(app?)` from `firebase-admin/auth`. Omitting the argument uses the default app; passing an app binds the Auth instance to that app.

```ts pmcp-example
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const app = initializeApp({ projectId: 'auth-example' }, 'auth-app');
const auth = getAuth(app);

assert.equal(typeof auth, 'object');
assert.equal(getAuth(app), auth);
```

This constructs the service without making a user or token request. User and token operations require Firebase credentials and a reachable Firebase service.

## Cloud Firestore

Use `getFirestore` or `initializeFirestore` from `firebase-admin/firestore`:

- `getFirestore()` gets the default database for the default app.
- `getFirestore(app)` gets the default database for a specific app.
- `getFirestore(databaseId)` selects a named database.
- `getFirestore(app, databaseId)` selects a named database for an app.
- `initializeFirestore(app, settings?)` initializes Firestore with settings such as `{ preferRest: true }`.

The named-database overloads are documented as Public Preview.

```ts pmcp-example
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, initializeFirestore } from 'firebase-admin/firestore';

const app = initializeApp({ projectId: 'firestore-example' }, 'firestore-app');
const firestore = getFirestore(app);
const restFirestore = initializeFirestore(
  initializeApp({ projectId: 'rest-example' }, 'rest-app'),
  { preferRest: true },
);

assert.equal(typeof firestore, 'object');
assert.equal(typeof restFirestore, 'object');
assert.equal(getFirestore(app), firestore);
```

The example does not read or write data, so it does not need network access. Firestore operations require a configured project and credentials.

## Cloud Messaging

Use `getMessaging(app?)` from `firebase-admin/messaging`. A message contains the base message fields and exactly one target: `fid`, `token` (deprecated), `topic`, or `condition`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const app = initializeApp({ projectId: 'messaging-example' }, 'messaging-app');
const messaging = getMessaging(app);

assert.equal(typeof messaging, 'object');
assert.equal(getMessaging(app), messaging);
```

Do not copy older Cloud Messaging message types: v14 removed legacy message types. Later 14.x releases also deprecate additional Messaging types, so check the exact installed 14.x release before depending on a type.

## Other documented modules

The documented module entry points also include:

- `firebase-admin/app-check`
- `firebase-admin/data-connect`
- `firebase-admin/database`
- `firebase-admin/eventarc`
- `firebase-admin/extensions`
- `firebase-admin/functions`
- `firebase-admin/installations`
- `firebase-admin/machine-learning`
- `firebase-admin/phone-number-verification`
- `firebase-admin/project-management`
- `firebase-admin/remote-config`
- `firebase-admin/security-rules`
- `firebase-admin/storage`

Use the corresponding module entry point rather than assuming a top-level namespace API. The reviewed material does not provide exact signatures or credential-free standalone behavior for these modules.

## Version and runtime cautions

- v14.0.0 requires Node.js 22 or newer.
- `^14.0.0` permits later 14.x releases. The release notes document additional changes in 14.1.0 and 14.2.0, including more Messaging deprecations and a Cloud Functions `taskQueue()` scoping change.
- SDK-wide error handling was revamped in v14.
- Deprecated `url.parse()` usage was replaced by Node's built-in `URL`.
- The SDK is for server applications, not browser or unprivileged client code.
- Service calls generally need Firebase credentials, project configuration, and network access. The examples above only exercise local initialization and service construction.

## Not covered

This skill does not cover service-operation signatures, credential-file setup, emulator configuration, Realtime Database, Storage, Cloud Functions, or the detailed APIs of the other documented modules. It also does not specify the exact error classes or error-handling migration rules introduced in v14, nor the precise later-14.x `taskQueue()` or Messaging changes.
