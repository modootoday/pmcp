import type { FixtureEnv } from "./worker.js";

declare const env: FixtureEnv;
env.MISSING;
env.CACHE.put("message", 42);
