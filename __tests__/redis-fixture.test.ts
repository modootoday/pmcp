import { expect, test } from "vitest";
const fixture = new URL(
  "../scripts/library-skills/fixtures/redis/verify.mjs",
  import.meta.url,
);
test.each([
  ["", /Pass redisUrl/u],
  ["http://127.0.0.1:6379", /redis:/u],
  ["redis://example.invalid:6379", /loopback/u],
  ["redis://127.0.0.1", /isolated service port/u],
  ["redis://127.0.0.1:6379/?token=example", /strictly equal/u],
  ["redis://127.0.0.1:6379/not-a-number", /regular expression/u],
])(
  "rejects unsafe Redis fixture endpoint %s before loading clients",
  async (redisUrl, message) => {
    const { verify } = await import(fixture.href);
    await expect(
      verify({ scratchRoot: "/tmp/pmcp-redis-unused", redisUrl }),
    ).rejects.toThrow(message);
  },
);
