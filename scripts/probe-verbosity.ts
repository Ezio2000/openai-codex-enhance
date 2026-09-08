// Six explicitly authorized main-model requests. No Fast mode, tools, conversation history or retries.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { HTTPTransport, isRecord, readSSE, redact } from "../src/shared/http.ts";
import { verbosityControl } from "../src/capabilities/verbosity/index.ts";

let secrets: string[] = [];
async function main() {
  if (process.argv.slice(2).join(" ") !== "--run") throw new Error("Pass --run for six real Codex responses (consumes quota).");
  const auth = JSON.parse(await readFile(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json"), "utf8"))["openai-codex"];
  if (auth?.type !== "oauth" || typeof auth.access !== "string" || auth.expires <= Date.now()) throw new Error("Unexpired Codex OAuth required; no refresh performed.");
  const accountId = auth.accountId ?? JSON.parse(Buffer.from(auth.access.split(".")[1], "base64url").toString("utf8"))["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (typeof accountId !== "string") throw new Error("Missing account ID.");
  secrets = [auth.access, accountId];
  const session = randomUUID();
  const dir = resolve("artifacts/verbosity", session);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const transport = new HTTPTransport(async () => ({ baseUrl: "https://chatgpt.com/backend-api/codex/", headers: {
    Authorization: `Bearer ${auth.access}`, "chatgpt-account-id": accountId, originator: "pi", session_id: session,
  } }));
  const rows: Record<string, unknown>[] = [];
  const prompts = ["Explain how database indexes work and when not to add one.", "Design a retry policy for a client that calls a payment API."];
  console.log(`Report: ${dir}/results.json`);
  for (let index = 0; index < prompts.length; index++) {
    for (const level of index === 0 ? ["low", "medium", "high"] : ["high", "medium", "low"]) {
      const body = verbosityControl.transform({ model: "gpt-6-astra", store: false, stream: true,
        instructions: "You are a helpful technical assistant. Answer in English.",
        input: [{ role: "user", content: [{ type: "input_text", text: prompts[index] }] }],
        reasoning: { effort: "low" }, text: { verbosity: "low" }, tools: [], parallel_tool_calls: true,
      }, level);
      const start = performance.now();
      const row: Record<string, unknown> = { case: index + 1, level, request: body };
      try {
        const response = await transport.post("responses", body, { timeoutMs: 180000, consume: async (response, signal) => {
          let final: Record<string, unknown> | undefined;
          let streamedText = "";
          const eventTypes = new Set<string>();
          for await (const event of readSSE(response, 4 * 1024 * 1024, signal)) {
            if (!isRecord(event.data)) continue;
            if (typeof event.data.type === "string") eventTypes.add(event.data.type);
            if (event.data.type === "response.output_text.delta" && typeof event.data.delta === "string") streamedText += event.data.delta;
            if (event.data.type === "error" || event.data.type === "response.failed" || event.data.type === "response.incomplete") throw new Error("Backend failed or returned incomplete response.");
            if (event.data.type === "response.completed" && isRecord(event.data.response)) final = event.data.response;
          }
          if (!final || final.status !== "completed") throw new Error("Missing completed response.");
          return { ...final, streamedText, eventTypes: [...eventTypes] } as Record<string, unknown>;
        } });
        const data = response.data;
        const finalText = (Array.isArray(data.output) ? data.output : []).filter(isRecord).filter(item => item.type === "message")
          .flatMap(item => Array.isArray(item.content) ? item.content : []).filter(isRecord)
          .filter(item => item.type === "output_text").map(item => String(item.text ?? "")).join("\n");
        const text = finalText || String(data.streamedText ?? "");
        if (!text) throw new Error(`No visible text captured; event types: ${JSON.stringify(data.eventTypes)}`);
        Object.assign(row, { eventTypes: data.eventTypes, model: data.model, serviceTier: data.service_tier, echoedText: data.text, usage: data.usage,
          text, chars: text.length, words: text.trim().split(/\s+/).length, ms: Math.round(performance.now() - start), requestId: response.requestId });
      } catch (error) { row.error = redact((error as Error).message, secrets); }
      rows.push(row);
      await writeFile(join(dir, "results.json"), redact(JSON.stringify({ date: new Date().toISOString(), rows }, null, 2), secrets), { mode: 0o600 });
      console.log(JSON.stringify({ case: row.case, level, chars: row.chars, words: row.words, ms: row.ms, usage: row.usage, error: row.error }));
      if (row.error) throw new Error("Probe stopped after failure; no retries.");
    }
  }
}
main().catch(error => { console.error(redact((error as Error).message, secrets)); process.exitCode = 1; });
