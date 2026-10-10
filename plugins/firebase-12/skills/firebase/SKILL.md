---
name: firebase
description: Use Firebase JS SDK ^12.0.0 with the modular API, correct v12 imports, and Node 20-compatible tooling. Covers app initialization, Auth and Firestore entry points, Firestore Lite query construction, compat migration traps, and v12 naming changes.
---

Verified against firebase@12.18.0 on 2026-09-08. 2 of 2 examples executed.

# Firebase JS SDK ^12.0.0

Firebase v12 uses the modular, function-based API. Install it with `npm install firebase`. Firebase v12 requires Node.js 20+ and targets ES2020; older build tooling may need updates.

## Prefer modular imports

Import functions from product subpaths rather than using a namespace:

```ts
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
```

Modular imports are tree-shakeable. The modular API generally requires a module bundler such as webpack or Rollup in application builds.

## App lifecycle

Use `initializeApp` to create an app, `getApp` to retrieve a named or default app, `getApps` to inspect initialized apps, and `deleteApp` to clean one up.

```ts pmcp-example
import assert from 'node:assert/strict';
import { initializeApp, getApp, getApps, deleteApp } from 'firebase/app';

const app = initializeApp({
  apiKey: 'test-api-key',
  authDomain: 'example.firebaseapp.com',
  projectId: 'example-project'
}, 'skill-example');

assert.equal(getApp('skill-example'), app);
assert.equal(getApps().includes(app), true);

await deleteApp(app);
assert.equal(getApps().some(candidate => candidate === app), false);
```

`initializeApp(options, name?)` accepts an optional name. Avoid initializing the same named app repeatedly; use `getApp(name)` or inspect `getApps()` when code may run more than once.

## Authentication

Get an Auth instance with `getAuth(app?)`, or use `initializeAuth(app, deps?)` when explicit initialization dependencies are needed:

```ts
import { getAuth, initializeAuth } from 'firebase/auth';
```

The Auth instance is associated with the Firebase app. Modular authentication functions receive that instance as an argument, for example `getRedirectResult(auth)` and `onAuthStateChanged(auth, callback)`.

A migration trap is the redirect-result shape: the old namespaced API returned a `UserCredential` whose `user` could be `null` when there was no redirect; modular `getRedirectResult(auth)` returns `null` when there was no redirect.

## Cloud Firestore

Use `getFirestore(app)` for the default database or `getFirestore(app, databaseId)` for a named database. Use `initializeFirestore(app, settings, databaseId?)` when Firestore settings must be supplied before obtaining the instance.

```ts
import { getFirestore, initializeFirestore } from 'firebase/firestore';
```

The Firestore API is usable for constructing references and queries without performing I/O:

```ts pmcp-example
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, collection, query, where } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'test-api-key',
  authDomain: 'example.firebaseapp.com',
  projectId: 'example-project'
}, 'firestore-skill-example');

const db = getFirestore(app);
const cities = collection(db, 'cities');
const capitalCities = query(cities, where('capital', '==', true));

assert.equal(capitalCities.type, 'query');
await deleteApp(app);
```

For reads, pass the query or collection to `getDocs`:

```ts
const snapshot = await getDocs(capitalCities);
const cities = snapshot.docs.map(doc => doc.data());
```

That read performs a backend operation and therefore is not suitable for an offline, standalone example. Firestore persistence and other environment support are product- and environment-specific.

## Firestore Lite

The Lite entry point is `firebase/firestore/lite`:

```ts
import { getFirestore, collection, getDocs } from 'firebase/firestore/lite';

const db = getFirestore(app);
const citiesCol = collection(db, 'cities');
const citySnapshot = await getDocs(citiesCol);
const cityList = citySnapshot.docs.map(doc => doc.data());
```

`getDocs` requires access to the configured Firebase backend when executed; do not assume it can run in an offline script.

## v12 naming changes

Firebase v12 removed `firebase/vertexai` and VertexAI-named symbols. Use the AI names instead:

```ts
import { getAI } from 'firebase/ai';
```

`getVertexAI`, `VertexAIError`, and the old `firebase/vertexai` import are not the v12 API. v12 also adds AI Logic grounding with Google Search, thinking budget, and `anyOf` schemas.

## Compat and migration pitfalls

Existing namespaced code can use the compatibility bridge, but compat is a migration path rather than the preferred long-term API and provides little or no modular size/performance advantage:

```ts
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

const auth = firebase.auth();
const db = firebase.firestore();
```

Do not mix old instance methods with modular functions mechanically. Typical translations include:

```ts
// Compat
const result = await auth.getRedirectResult();

// Modular
const result = await getRedirectResult(auth);
```

```ts
// Compat snapshot
if (snapshot.exists) {}

// Modular snapshot
if (snapshot.exists()) {}
```

In browser script-tag integrations, `window.firebase` is the compat path; the modular npm API is not exposed that way.

## Environment notes

Firebase v12 itself requires Node 20+, although product-specific support documentation also describes browser, Node, extension, React Native, and Cordova environments. Polyfills may still be needed. Analytics, Installations, Messaging, Performance Monitoring, and Remote Config do not work in Node.js. Firestore edge/Node support excludes persistence, and Storage edge support excludes uploads.

## Not covered

This skill does not cover product-specific configuration values, authentication providers or sign-in flows, Firestore writes and security rules, persistence setup, Storage, Analytics, Messaging, Remote Config, Performance Monitoring, or the detailed AI API. It also does not cover Firebase CLI commands, framework integration, bundler configuration, or network-backed tests.
