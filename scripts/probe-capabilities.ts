// Explicit live probes of the current supported surface. No SDK and no retries.
// --web: four data commands; --images: one generation with production defaults (billable).
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { ImageArtifactStore } from "../src/capabilities/image/artifacts.ts";
import { WebClient } from "../src/capabilities/web/client.ts";
import { ImageClient } from "../src/capabilities/image/client.ts";
import { ProtocolError, redact } from "../src/shared/http.ts";
import { IMAGE_DEFAULTS } from "../src/capabilities/image/types.ts";
import type { SearchCommands } from "../src/capabilities/web/types.ts";
import { imageWarnings } from "../src/capabilities/image/warnings.ts";

let secrets: string[] = [];
async function main() {
  const flags = process.argv.slice(2);
  if (!flags.length || flags.some(flag => !["--web", "--images"].includes(flag))) throw new Error("Use --web and/or --images. --images generates one image and consumes quota.");
  const credentials = JSON.parse(await readFile(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json"), "utf8"))["openai-codex"];
  if (credentials?.type !== "oauth" || typeof credentials.access !== "string" || credentials.expires <= Date.now()) throw new Error("An unexpired Codex OAuth login is required; this probe does not refresh tokens.");
  const token = credentials.access;
  const accountId = credentials.accountId ?? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (typeof accountId !== "string") throw new Error("Missing Codex account ID.");
  secrets = [token, accountId];
  const resolveAuth = async () => ({ baseUrl: "https://chatgpt.com/backend-api/codex/", headers: {
    Authorization: `Bearer ${token}`, "chatgpt-account-id": accountId, originator: "pi",
  } });
  const client = new WebClient(resolveAuth);
  const imagesClient = new ImageClient(resolveAuth);
  const id = randomUUID();
  const directory = resolve("artifacts/capabilities", id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const results: Record<string, unknown>[] = [];
  async function probe(name: string, operation: () => Promise<Record<string, unknown>>) {
    console.log(`START ${name}`);
    const started = Date.now();
    let row: Record<string, unknown>;
    try { row = { name, ...await operation() }; }
    catch (error) {
      row = { name, error: redact(error instanceof Error ? error.message : "Probe failed", secrets),
        status: error instanceof ProtocolError ? error.status : undefined };
      process.exitCode = 1;
    }
    row.durationMs = Date.now() - started;
    results.push(row);
    const report = redact(JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2), secrets);
    await writeFile(join(directory, "results.json"), report, { mode: 0o600 });
    console.log(redact(JSON.stringify(row, null, 2), secrets));
  }
  if (flags.includes("--web")) {
    const operations: [string, SearchCommands][] = [
      ["web-time", { time: [{ utc_offset: "+08:00" }] }],
      ["web-weather", { weather: [{ location: "China, Shanghai, Shanghai", duration: 1 }] }],
      ["web-finance", { finance: [{ ticker: "MSFT", type: "equity", market: "USA" }] }],
      ["web-sports", { sports: [{ tool: "sports", fn: "standings", league: "epl" }] }],
    ];
    for (const [name, commands] of operations) await probe(name, async () => {
      const result = await client.search({ id: randomUUID(), model: "gpt-6-astra", commands: { ...commands, response_length: "short" },
        settings: { allowed_callers: ["direct"], external_web_access: true }, max_output_tokens: 2000 });
      return { commands, requestId: result.requestId, output: result.data.output, results: result.data.results };
    });
  }
  if (flags.includes("--images")) await probe("image-transparent", async () => {
    const request = { ...IMAGE_DEFAULTS, prompt: "A simple flat red circle on a transparent background. No text. A tall portrait canvas.", size: "1024x1536", background: "transparent" as const };
    const result = await imagesClient.images(request, { turnId: id, timeoutMs: 300000 });
    const images = await new ImageArtifactStore(directory).saveImages(id, result.data.data);
    return { requested: request, requestId: result.requestId, images,
      warnings: imageWarnings(request, result.data, images), usage: result.data.usage,
      outputFormat: result.data.output_format, quality: result.data.quality, background: result.data.background, size: result.data.size };
  });
  console.log(`Report: ${join(directory, "results.json")}`);
}
main().catch(error => {
  console.error(redact(error instanceof Error ? error.message : "Probe failed", secrets));
  process.exitCode = 1;
});
