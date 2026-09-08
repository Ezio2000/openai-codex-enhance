import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProtocolAuth } from "./types.ts";

export function codexBaseURL(raw = "https://chatgpt.com/backend-api"): string {
  const url = new URL(raw);
  // Never forward subscription credentials to an arbitrary host, redirect or public API endpoint.
  if (url.origin !== "https://chatgpt.com" || url.username || url.password || url.search || url.hash) {
    throw new Error("openai-codex-enhance only sends Codex credentials to https://chatgpt.com. Custom gateways require an explicit, separately audited transport.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!["/backend-api", "/backend-api/codex", "/backend-api/codex/responses"].includes(path)) throw new Error("Unrecognized Codex provider base URL.");
  return "https://chatgpt.com/backend-api/codex/";
}

// Codex OAuth is stored per provider in pi's registry, independent of the active main model,
// so image generation works while any other provider drives the session.
export async function resolveCodexAuth(ctx: Pick<ExtensionContext, "modelRegistry">): Promise<ProtocolAuth> {
  let resolved: Awaited<ReturnType<typeof ctx.modelRegistry.getProviderAuth>>;
  try { resolved = await ctx.modelRegistry.getProviderAuth("openai-codex"); }
  catch { throw new Error("Could not resolve/refresh Codex authentication. Run /login openai-codex. Raw authentication errors are omitted to protect credentials."); }
  const auth = resolved?.auth;
  if (!auth) throw new Error("No Codex credentials. Run /login openai-codex.");
  const headers = new Headers();
  for (const [key, value] of Object.entries(auth.headers ?? {})) if (typeof value === "string") headers.set(key, value);
  const token = auth.apiKey ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Codex authentication did not resolve an access token.");
  // OAuth access tokens are JWTs; a platform API key is not and can never carry the account claim.
  if (!headers.get("authorization") && token.split(".").length !== 3) throw new Error("These tools require /login openai-codex (ChatGPT OAuth), not a public API key.");
  let accountId = headers.get("chatgpt-account-id");
  if (!accountId) {
    try {
      // Same claim used by pi's Codex provider. This is extraction, not JWT verification.
      const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
      const value = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
      if (typeof value === "string" && value) accountId = value;
    } catch { /* Report only a generic error, never the token. */ }
  }
  if (!accountId) throw new Error("Codex token is missing the account ID. Run /login openai-codex again.");
  const baseUrl = codexBaseURL(auth.baseUrl);
  // No generic provider cookies/headers: only the credentials needed by this documented Codex flow.
  return { baseUrl, headers: {
    Authorization: `Bearer ${token}`,
    "chatgpt-account-id": accountId,
    originator: "pi",
    "User-Agent": "openai-codex-enhance/0.1.0",
  } };
}
