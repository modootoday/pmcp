import SchemaBuilder from "@pothos/core";

const builder = new SchemaBuilder({});
builder.queryType({
  fields: (t) => ({
    title: t.string({
      // @ts-expect-error A String field must resolve a string or null.
      resolve: () => 42,
    }),
  }),
});
