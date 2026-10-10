export function createServer(McpServer, z, onCall) {
  const server = new McpServer({ name: "library-fixture", version: "1.0.0" });
  server.registerTool(
    "read-item",
    {
      description: "Read a fixture item by its identifier",
      inputSchema: z.object({ itemId: z.string().min(1) }).strict(),
      outputSchema: z.object({ itemId: z.string(), title: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ itemId }) => {
      onCall();
      if (itemId === "missing") {
        return {
          content: [{ type: "text", text: "Item unavailable" }],
          isError: true,
        };
      }
      const item = { itemId, title: "Fixture item" };
      return {
        content: [{ type: "text", text: item.title }],
        structuredContent: item,
      };
    },
  );
  return server;
}
