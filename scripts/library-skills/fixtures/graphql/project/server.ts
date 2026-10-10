import { initContextCache } from "@pothos/core";
import { createYoga } from "graphql-yoga";
import { schema } from "./schema.js";

export const yoga = createYoga({
  schema,
  logging: false,
  maskedErrors: { isDev: false },
  context: ({ request }) => ({
    ...initContextCache(),
    requestId: request.headers.get("x-request-id") ?? "anonymous",
  }),
});
