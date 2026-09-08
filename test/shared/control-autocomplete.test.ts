import test from "node:test";
import assert from "node:assert/strict";
import { CombinedAutocompleteProvider, type AutocompleteProvider } from "@earendil-works/pi-tui";
import { codexCommandAutocomplete } from "../../src/shared/control-autocomplete.ts";

test("real pi slash completions hide the command and arguments when the extension is disposed", async () => {
  let visible = true;
  const base = new CombinedAutocompleteProvider([
    { name: "openai-codex-enhance", getArgumentCompletions: () => [{ value: "fast on", label: "fast on" }] },
    { name: "help" },
  ], "/unused");
  const provider = codexCommandAutocomplete(base, () => visible);
  const suggest = (text: string) => provider.getSuggestions([text], 0, text.length, { signal: new AbortController().signal });
  assert.equal((await suggest("/"))?.items.length, 2);
  visible = false;
  assert.deepEqual((await suggest("/"))?.items.map(item => item.value), ["help"]);
  assert.equal(await suggest("/openai-codex-enhance"), null);
  assert.equal(await suggest("/openai-codex-enhance f"), null);
  const lines = ["/openai"];
  assert.deepEqual(provider.applyCompletion(lines, 0, 7, { value: "openai-codex-enhance", label: "" }, "/openai"), { lines, cursorLine: 0, cursorCol: 7 });
  visible = true;
  assert.equal((await suggest("/openai-codex-enhance f"))?.items[0]?.value, "fast on");
  assert.match(provider.applyCompletion(lines, 0, 7, { value: "openai-codex-enhance", label: "" }, "/openai").lines[0]!, /^\/openai-codex-enhance /);
});

test("filter checks lifecycle visibility after asynchronous completion and preserves unrelated providers", async () => {
  let visible = true;
  let finish!: (value: any) => void;
  const base = {
    triggerCharacters: ["#"],
    getSuggestions: () => new Promise(resolve => { finish = resolve; }),
    applyCompletion: (lines: string[], cursorLine: number, cursorCol: number) => ({ lines, cursorLine, cursorCol }),
    shouldTriggerFileCompletion: () => false,
  } as AutocompleteProvider;
  const provider = codexCommandAutocomplete(base, () => visible);
  const pending = provider.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal });
  visible = false;
  finish({ prefix: "/", items: [{ value: "openai-codex-enhance", label: "" }, { value: "unrelated", label: "" }] });
  assert.deepEqual((await pending)?.items.map(item => item.value), ["unrelated"]);
  assert.deepEqual(provider.triggerCharacters, ["#"]);
  assert.equal(provider.shouldTriggerFileCompletion!([""], 0, 0), false);
});
