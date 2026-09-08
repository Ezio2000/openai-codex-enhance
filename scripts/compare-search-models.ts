// Explicit live A/B probe: 24 sequential search requests, no retries or image calls.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { WebClient } from "../src/capabilities/web/client.ts";
import { ProtocolError, redact } from "../src/shared/http.ts";
import type { SearchCommands } from "../src/capabilities/web/types.ts";

let secrets: string[] = [];
async function main() {
  if (process.argv.slice(2).join(" ") !== "--run") throw new Error("Pass --run for 24 real search requests (consumes search quota).");
  const credentials = JSON.parse(await readFile(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json"), "utf8"))["openai-codex"];
  if (credentials?.type !== "oauth" || typeof credentials.access !== "string" || credentials.expires <= Date.now()) throw new Error("An unexpired Codex OAuth login is required; this probe does not refresh tokens.");
  const token = credentials.access;
  const accountId = credentials.accountId ?? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (typeof accountId !== "string") throw new Error("Missing account ID.");
  secrets = [token, accountId];
  const id = randomUUID();
  const directory = resolve("artifacts/search-model-comparison", id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const rows: Record<string, any>[] = [];
  let observed: Record<string, unknown> = {};
  const client = new WebClient(async () => ({ baseUrl: "https://chatgpt.com/backend-api/codex/", headers: {
    Authorization: `Bearer ${token}`, "chatgpt-account-id": accountId, originator: "pi",
  } }), async (url, init) => {
    const start = performance.now();
    const response = await fetch(url, init);
    const selected = Object.fromEntries([...response.headers].filter(([key]) => /^(age|x-cache|x-cache-hits|cf-cache-status|server-timing|openai-processing-ms|x-processing-ms|x-request-id)$/.test(key)));
    observed = { status: response.status, headersMs: Math.round(performance.now() - start), headers: selected };
    return response;
  });
  const models = ["gpt-5.6-luna", "gpt-6-astra"];
  const cases: [string, SearchCommands][] = [
    ["openai-search", { search_query: [{ q: "OpenAI GPT Image 2 image generation size background documentation", domains: ["developers.openai.com"] }] }],
    ["mdn-search", { search_query: [{ q: "AbortSignal.timeout active time TimeoutError", domains: ["developer.mozilla.org"] }] }],
    ["mdn-open", { open: [{ ref_id: "https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static" }] }],
  ];
  const common = { id, settings: { allowed_callers: ["direct"] as ["direct"], external_web_access: true }, max_output_tokens: 1500 };
  console.log(`Report: ${directory}/results.json`);
  for (let round = 0; round < 4; round++) {
    for (const [caseName, commands] of cases) {
      // Balance first/second position across rounds. Identical session ID and parameters except model.
      const order = round % 2 ? [...models].reverse() : models;
      for (const model of order) {
        observed = {};
        const start = performance.now();
        const row: Record<string, any> = { round: round + 1, caseName, model, position: order.indexOf(model) + 1 };
        try {
          const result = await client.search({ ...common, model, commands: { ...commands, response_length: "short" } }, { timeoutMs: 90000 });
          const { encrypted_output: _encrypted, ...data } = result.data;
          const normalized = data.output.replace(/turn\d+[a-z]+\d+/g, "REF");
          row.response = data;
          row.responseKeys = Object.keys(result.data);
          row.outputChars = data.output.length;
          row.normalizedOutputHash = createHash("sha256").update(normalized).digest("hex");
          row.urls = [...new Set(data.output.match(/https?:\/\/[^\s<>\)\]"\\]+/g) ?? [])];
          row.requestId = result.requestId;
        } catch (error) {
          row.error = redact(error instanceof Error ? error.message : "Request failed", secrets);
          row.errorStatus = error instanceof ProtocolError ? error.status : undefined;
          process.exitCode = 1;
        }
        Object.assign(row, observed, { durationMs: Math.round(performance.now() - start) });
        rows.push(row);
        await writeFile(join(directory, "results.json"), redact(JSON.stringify({ testedAt: new Date().toISOString(), common, cases, rows }, null, 2), secrets), { mode: 0o600 });
        console.log(JSON.stringify({ round: row.round, caseName, model, status: row.status, ms: row.durationMs, chars: row.outputChars, error: row.error }));
        if (row.errorStatus === 401 || row.errorStatus === 403 || row.errorStatus === 429) throw new Error("Stopping on auth/quota rejection; no retries.");
      }
    }
  }
}
main().catch(error => { console.error(redact(error instanceof Error ? error.message : "Probe failed", secrets)); process.exitCode = 1; });
