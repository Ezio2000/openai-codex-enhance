import { isRecord } from "./http.ts";

export interface HistoryMessage { role: string; content?: unknown; toolName?: string; details?: unknown }
// Use the extension's read-only session API, respecting compaction and the active branch.
export function contextMessages(entries: readonly unknown[]): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry.type === "compaction" && Array.isArray(entry.retainedTail)) {
      for (const message of entry.retainedTail) if (isRecord(message) && typeof message.role === "string") messages.push(message as unknown as HistoryMessage);
    } else if (entry.type === "message" && isRecord(entry.message) && typeof entry.message.role === "string") {
      messages.push(entry.message as unknown as HistoryMessage);
    }
  }
  return messages;
}
