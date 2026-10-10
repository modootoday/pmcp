declare const env: Env;
const mode: "fixture" = env.MODE;
const value: Promise<string | null> = env.CACHE.get("message");
void mode;
void value;
