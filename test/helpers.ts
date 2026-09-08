import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebClient } from "../src/capabilities/web/client.ts";
import { ImageClient } from "../src/capabilities/image/client.ts";
import type { SearchRequest } from "../src/capabilities/web/types.ts";
import type { ImageRequest } from "../src/capabilities/image/types.ts";

export const auth = async () => ({ baseUrl: "https://chatgpt.com/backend-api/codex/", headers: { Authorization: "Bearer test-secret", "chatgpt-account-id": "test-account" } });
export const search: SearchRequest = { id: "session", model: "gpt-6-astra", commands: { search_query: [{ q: "OpenAI docs" }] } };
export const image: ImageRequest = { model: "gpt-image-2", prompt: "A small blue square" };
export const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
export const ctx = (cwd: string, messages: unknown[] = []) => ({
  cwd, model: { provider: "openai-codex", id: "gpt-6-astra" },
  sessionManager: { getSessionId: () => "session", getBranch: () => messages.map(message => ({ type: "message", message })), buildContextEntries: () => messages.map(message => ({ type: "message", message })) },
}) as unknown as ExtensionContext;

type Capture = (path: string, body: Record<string, any>) => unknown;
const mockAuth = async () => ({ baseUrl: "https://chatgpt.com/backend-api/codex/", headers: { Authorization: "Bearer mock" } });
const captureFetch = (capture: Capture): typeof fetch => async (url, init) => json(capture(String(url), JSON.parse(String(init?.body))));
export const fakeWebClient = (capture: Capture) => new WebClient(mockAuth, captureFetch(capture));
export const fakeImageClient = (capture: Capture) => new ImageClient(mockAuth, captureFetch(capture));
