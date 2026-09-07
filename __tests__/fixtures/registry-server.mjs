import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { appendFileSync, readFileSync } from "node:fs";

const archive = readFileSync(process.env.ARCHIVE);
const tls = {
  key: readFileSync(process.env.TLS_KEY),
  cert: readFileSync(process.env.TLS_CERT),
};
const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
const shasum = createHash("sha1").update(archive).digest("hex");
const server = createServer(tls, (request, response) => {
  if (process.env.LOG)
    appendFileSync(
      process.env.LOG,
      `${JSON.stringify({ path: request.url, authorization: request.headers.authorization?.replace(/pmcp_[A-Za-z0-9_-]+/g, "[redacted]") ?? null })}\n`,
    );
  const accepted = new Set([
    "Bearer pmcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    `Basic ${Buffer.from("pmcp:pmcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").toString("base64")}`,
  ]);
  if (!accepted.has(request.headers.authorization ?? "")) {
    response.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate":
        'Basic realm="pmcp npm registry", Bearer realm="pmcp npm registry"',
    });
    response.end('{"error":"authentication required"}');
    return;
  }
  const origin = `https://127.0.0.1:${server.address().port}`;
  const path = decodeURIComponent(new URL(request.url ?? "/", origin).pathname);
  if (path === "/artifact.tgz") {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(archive);
    return;
  }
  if (
    path === "/@modootoday/pmcp-example" ||
    path === "/@modootoday/pmcp-example/1.0.0"
  ) {
    const version = {
      name: "@modootoday/pmcp-example",
      version: "1.0.0",
      dist: { tarball: `${origin}/artifact.tgz`, integrity, shasum },
      scripts: {
        postinstall:
          "node -e \"require('fs').writeFileSync(process.env.PMCP_TEST_MARKER,'unexpected')\"",
      },
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        path.endsWith("/1.0.0")
          ? version
          : {
              name: "@modootoday/pmcp-example",
              "dist-tags": { latest: "1.0.0" },
              versions: { "1.0.0": version },
            },
      ),
    );
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end('{"error":"not found"}');
});
server.listen(0, "127.0.0.1", () =>
  process.stdout.write(`${server.address().port}\n`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => server.close(() => process.exit(0)));
