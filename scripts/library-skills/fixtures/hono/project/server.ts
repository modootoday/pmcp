import { Hono } from "hono";
import { validator } from "hono/validator";

const route = new Hono().post(
  "/items",
  validator("json", (value: { title: string }, c) => {
    if (typeof value?.title !== "string")
      return c.json({ error: "title" }, 400);
    return { title: value.title };
  }),
  (c) => c.json({ title: c.req.valid("json").title }, 201),
);

export type AppType = typeof route;
export default route;
