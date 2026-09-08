import test from "node:test";
import assert from "node:assert/strict";
import { codexBaseURL, resolveCodexAuth } from "../../src/shared/auth.ts";

test("Codex endpoint resolution prevents credential exfiltration", () => {
  for (const path of ["/backend-api", "/backend-api/codex/", "/backend-api/codex/responses"]) assert.equal(codexBaseURL(`https://chatgpt.com${path}`), "https://chatgpt.com/backend-api/codex/");
  for (const url of ["https://evil.example/backend-api", "http://chatgpt.com/backend-api", "https://chatgpt.com.evil.example/backend-api", "https://chatgpt.com/backend-api?token=x", "https://api.openai.com/v1", "https://user@chatgpt.com/backend-api", "https://chatgpt.com/other"]) assert.throws(() => codexBaseURL(url));
});

test("pi adapter resolves OAuth via registry and extracts account claim without reading auth.json", async () => {
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } })).toString("base64url")}.signature`;
  let called = 0;
  const ctx = { model: { provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api" }, modelRegistry: {
    getProviderAuth: async (provider: string) => { assert.equal(provider, "openai-codex"); called++; return { auth: { apiKey: token } }; },
  } } as unknown as Parameters<typeof resolveCodexAuth>[0];
  const result = await resolveCodexAuth(ctx);
  assert.equal(called, 1); assert.equal(result.headers["chatgpt-account-id"], "account");
  assert.equal(result.headers.Authorization, `Bearer ${token}`);
});

test("raw pi auth exceptions cannot leak tokens to the model", async () => {
  const ctx = { model: { provider: "openai-codex" }, modelRegistry: { getProviderAuth: async () => { throw new Error("refresh response: secret-value"); } } } as unknown as Parameters<typeof resolveCodexAuth>[0];
  await assert.rejects(resolveCodexAuth(ctx), (error: Error) => { assert.doesNotMatch(error.message, /secret-value/); return true; });
});

test("codex_image credentials resolve while the main model runs on another provider", async () => {
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } })).toString("base64url")}.signature`;
  const ctx = { model: { provider: "anthropic" }, modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: token } }) } } as unknown as Parameters<typeof resolveCodexAuth>[0];
  const result = await resolveCodexAuth(ctx);
  assert.equal(result.headers.Authorization, `Bearer ${token}`);
  assert.equal(result.headers["chatgpt-account-id"], "account");
});

test("a platform API key on the stored provider auth is still rejected", async () => {
  const ctx = { modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "sk-platform-key" } }) } } as unknown as Parameters<typeof resolveCodexAuth>[0];
  await assert.rejects(resolveCodexAuth(ctx), /not a public API key/);
});
