import type { HistoryMessage } from "../../shared/context.ts";
import { isRecord } from "../../shared/http.ts";
import type { ImageSource } from "./schema.ts";

export function recentImages(messages: readonly HistoryMessage[], count: number): ImageSource[] {
  const sources: ImageSource[] = [];
  for (const message of messages) {
    if (!["user", "assistant", "toolResult"].includes(message.role)) continue;
    if (message.role === "toolResult" && message.toolName === "codex_image" && isRecord(message.details) && message.details.version === 1 && Array.isArray(message.details.images)) {
      const saved = message.details.images.filter(isRecord).filter(image => typeof image.path === "string");
      if (saved.length) {
        sources.push(...saved.map(image => ({ path: image.path as string })));
        continue; // Do not also include downscaled previews of the same images.
      }
    }
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isRecord(block) && block.type === "image" && typeof block.data === "string" && ["image/png", "image/jpeg", "image/webp"].includes(String(block.mimeType))) {
        sources.push({ image_url: `data:${block.mimeType};base64,${block.data}` });
      }
    }
  }
  if (sources.length < count) throw new Error(`Only ${sources.length} image(s) are available in the active context; provide paths or reattach the missing images.`);
  return sources.slice(-count);
}
