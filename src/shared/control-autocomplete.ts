import type { AutocompleteProvider } from "@earendil-works/pi-tui";

const isControlCommand = (value: string) => /^openai-codex-enhance(?::\d+)?$/.test(value.replace(/^\//, ""));

// pi 0.85.1 has no unregisterCommand/visibility predicate. Suppress stale TUI
// completions after extension shutdown; while active, the command is universal.
export function codexCommandAutocomplete(current: AutocompleteProvider, visible: () => boolean): AutocompleteProvider {
  return {
    triggerCharacters: current.triggerCharacters,
    async getSuggestions(lines, line, col, options) {
      const result = await current.getSuggestions(lines, line, col, options);
      if (!result || visible() || options?.force) return result;
      const before = (lines[line] ?? "").slice(0, col);
      if (!before.startsWith("/")) return result;
      const command = before.slice(1).split(/\s/, 1)[0]!;
      if (/\s/.test(before) && isControlCommand(command)) return null;
      if (/\s/.test(before) || !result.prefix.startsWith("/")) return result;
      const items = result.items.filter(item => !isControlCommand(item.value));
      return items.length ? { ...result, items } : null;
    },
    applyCompletion(lines, line, col, item, prefix) {
      if (!visible() && prefix.startsWith("/") && isControlCommand(item.value)) return { lines, cursorLine: line, cursorCol: col };
      return current.applyCompletion(lines, line, col, item, prefix);
    },
    shouldTriggerFileCompletion: (lines, line, col) => current.shouldTriggerFileCompletion?.(lines, line, col) ?? true,
  };
}
