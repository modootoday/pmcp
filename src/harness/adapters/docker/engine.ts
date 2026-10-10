import { request } from "node:http";
import { command } from "../process/command.js";
import { assertLocalDocker } from "./profile.js";
import { object, text } from "../../validation.js";

export class DockerEngine {
  async create(
    name: string,
    configuration: Record<string, unknown>,
  ): Promise<string> {
    assertLocalDocker();
    const endpoint = JSON.parse(
      command("docker", [
        "context",
        "inspect",
        "--format",
        "{{json .Endpoints.docker.Host}}",
      ]),
    );
    const version = command("docker", [
      "version",
      "--format",
      "{{.Server.APIVersion}}",
    ]).trim();
    if (!/^1\.\d+$/.test(version))
      throw new Error("invalid_docker_api_version");
    const payload = JSON.stringify(configuration);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: new URL(endpoint).pathname,
          path: `/v${version}/containers/create?name=${encodeURIComponent(name)}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 65536) {
              req.destroy(new Error("docker_response_too_large"));
              return;
            }
            chunks.push(chunk);
          });
          response.once("error", reject);
          response.once("end", () => {
            if (response.statusCode !== 201) {
              reject(new Error(`docker_create_status_${response.statusCode}`));
              return;
            }
            try {
              const id = text(
                object(JSON.parse(Buffer.concat(chunks).toString("utf8"))).Id,
                "container_id",
              );
              if (!/^[a-f0-9]{64}$/.test(id))
                throw new Error("invalid_container_id");
              resolve(id);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.setTimeout(10000, () =>
        req.destroy(new Error("docker_create_timeout")),
      );
      req.once("error", reject);
      req.end(payload);
    });
  }
}
