import { hc } from "hono/client";
import type { AppType } from "./dist/server.js";

const client = hc<AppType>("http://localhost");
const response = await client.items.$post({ json: { title: "first" } });

// @ts-expect-error RPC inputs preserve the server contract.
client.items.$post({ json: { title: 42 } });

if (response.status === 201) {
  const created = await response.json();
  const title: string = created.title;
  // @ts-expect-error Successful response titles remain strings.
  const number: number = created.title;
  void title;
  void number;
}

if (response.status === 400) {
  const rejected = await response.json();
  const error: string = rejected.error;
  // @ts-expect-error Error responses carry no created title.
  const title = rejected.title;
  void error;
  void title;
}
