import type { IncomingMessage, ServerResponse } from "node:http";

export const send = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};
export async function body(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) text += chunk.toString();
  return text;
}
