import SchemaBuilder from "@pothos/core";

export type Context = { requestId: string };

const builder = new SchemaBuilder<{ Context: Context }>({});
builder.queryType({
  fields: (t) => ({
    greeting: t.string({
      nullable: false,
      args: { name: t.arg.string({ required: true }) },
      resolve: (_parent, { name }) => `Hello ${name}`,
    }),
    requestId: t.string({
      nullable: false,
      resolve: (_parent, _args, context) => context.requestId,
    }),
    failure: t.string({
      resolve: () => {
        throw new Error("fixture-private-error");
      },
    }),
  }),
});

export const schema = builder.toSchema();
