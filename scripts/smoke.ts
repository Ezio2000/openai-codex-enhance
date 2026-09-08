// Explicit developer-only integration probe. No SDK, no implicit requests on extension load.
// This test reads an existing *unexpired* login; production uses pi's auth resolver instead.
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ImageArtifactStore, imageInfo } from "../src/capabilities/image/artifacts.ts";
import { WebClient } from "../src/capabilities/web/client.ts";
import { ImageClient } from "../src/capabilities/image/client.ts";
import { ProtocolError } from "../src/shared/http.ts";
import { imageWarnings } from "../src/capabilities/image/warnings.ts";
import { IMAGE_DEFAULTS } from "../src/capabilities/image/types.ts";

async function main() {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const credentials = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"))["openai-codex"];
  if (credentials?.type !== "oauth" || typeof credentials.access !== "string" || credentials.expires <= Date.now()) throw new Error("An unexpired /login openai-codex session is required. This script does not refresh tokens.");
  const token = credentials.access;
  const claim = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const accountId = credentials.accountId ?? claim["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (typeof accountId !== "string") throw new Error("No account ID.");
  const resolveAuth = async () => ({ baseUrl: "https://chatgpt.com/backend-api/codex/", headers: {
    Authorization: `Bearer ${token}`, "chatgpt-account-id": accountId, originator: "pi",
  } });
  const client = new WebClient(resolveAuth);
  const imagesClient = new ImageClient(resolveAuth);
  const id = randomUUID();
  const model = process.env.PI_MODEL ?? "gpt-6-astra";
  const request = { id, model, settings: { allowed_callers: ["direct"] as ["direct"], external_web_access: true }, max_output_tokens: 1500 };
  const search = await client.search({ ...request, commands: { search_query: [{ q: "OpenAI image generation gpt-image-2 documentation", domains: ["developers.openai.com"] }], response_length: "short" } });
  console.log("search: OK", { requestId: search.requestId, outputChars: search.data.output.length, structuredResults: search.data.results?.length });
  const ref = /turn\d+search\d+/.exec(search.data.output)?.[0];
  if (!ref) throw new Error("Search returned no reusable search reference.");
  const opened = await client.search({ ...request, commands: { open: [{ ref_id: ref }], response_length: "short" } });
  if (!/Source: open\(|turn\d+(?:view|fetch)\d+/.test(opened.data.output)) throw new Error("Search reference did not produce an opened page.");
  console.log("open search ref: OK", { outputChars: opened.data.output.length, requestId: opened.requestId });
  if (!process.argv.includes("--images")) { console.log("Images not tested. Pass --images to generate and edit one image (consumes quota)."); return; }

  const store = new ImageArtifactStore(resolve("artifacts/smoke"));
  const generated = await imagesClient.images({ ...IMAGE_DEFAULTS, prompt: "A single solid blue circle centered on a plain white background. No text.", size: "auto" }, { turnId: id, timeoutMs: 300000 });
  const saved = await store.saveImages(id, generated.data.data);
  console.log("generate PNG: OK", { requestId: generated.requestId, paths: saved.map(x => x.path), format: generated.data.output_format });
  const original = await readFile(saved[0]!.path);
  const info = imageInfo(original);
  if (!info.width || !info.height) throw new Error("Could not read generated image dimensions.");
  const edited = await imagesClient.images({
    ...IMAGE_DEFAULTS, prompt: "Change the blue circle to a green circle. Preserve the white background, composition and size.",
    images: [{ image_url: `data:${info.mimeType};base64,${original.toString("base64")}` }],
    size: "auto",
  }, { turnId: randomUUID(), timeoutMs: 300000 });
  const editedFiles = await store.saveImages(id, edited.data.data);
  console.log("edit PNG: OK", { requestId: edited.requestId, paths: editedFiles.map(x => x.path), format: edited.data.output_format });
  const warnings = [...imageWarnings({ ...IMAGE_DEFAULTS, prompt: "probe" }, generated.data, saved), ...imageWarnings({ ...IMAGE_DEFAULTS, prompt: "probe" }, edited.data, editedFiles)];
  for (const warning of warnings) console.warn("COMPATIBILITY:", warning);
  await writeFile(resolve("artifacts/smoke/last-result.json"), JSON.stringify({ testedAt: new Date().toISOString(), generated: saved, edited: editedFiles, warnings, checks: ["search", "open-reference", "generate", "edit"], pngHonored: [...saved, ...editedFiles].every(image => image.mimeType === "image/png") }, null, 2), { mode: 0o600 });
}
main().catch(error => {
  // Protocol errors are already redacted. Never print raw credential/storage objects or stacks.
  console.error(error instanceof ProtocolError ? error.message : "Smoke test failed: " + (error instanceof Error ? error.message : "unknown error"));
  process.exitCode = 1;
});
