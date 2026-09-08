import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { verbosityControl } from "../src/capabilities/verbosity/index.ts";
import { imageDetailControl } from "../src/capabilities/image-detail/index.ts";
import { fastControl } from "../src/capabilities/fast/index.ts";

export const controls = [verbosityControl, imageDetailControl, fastControl];
export function model(id = "gpt-6-astra", provider = "openai-codex"): NonNullable<ExtensionContext["model"]> {
  return { id, name: id, provider, api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api", reasoning: true,
    input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 10000 };
}
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
