import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createControlFooter, footerCwd } from "../../src/shared/control-footer.ts";
import { model } from "../request-control-helpers.ts";

test("controls share the cwd line and exactly the same dim colour; late non-Codex renders are empty", () => {
  let active = model();
  let disposed = false;
  const calls: string[] = [];
  const ctx = () => ({ model: active, cwd: join(homedir(), "program/github"), thinkingLevel: "low",
    getContextUsage: () => ({ percent: 12.3 }),
    sessionManager: { getEntries: () => [], getSessionName: () => undefined },
  }) as unknown as ExtensionContext;
  const factory = createControlFooter(ctx, () => "Codex | verbosity:high | image-detail:original | fast:on(2.5x)", "ours");
  const footer = factory({ requestRender() {} } as any, { fg: (colour: string, text: string) => { calls.push(colour); return `\x1b[90m${text}\x1b[0m`; } } as any, {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map([["ours", "MUST NOT DUPLICATE"], ["other", "other extension"]]),
    onBranchChange: () => () => { disposed = true; },
  } as any);
  const first = footer.render(120);
  assert.match(first[0]!, /^\x1b\[90m~\/program\/github  verbosity:high  image:original  fast:on\(2\.5x\)\x1b\[0m$/);
  assert.equal(first[2], "other extension");
  assert.doesNotMatch(first.join("\n"), /MUST NOT DUPLICATE/);
  assert.deepEqual(calls, ["dim", "dim"]);
  for (const width of [1, 20, 60, 80, 120]) assert.ok(footer.render(width).every(line => visibleWidth(line) <= width));
  active = model("some-other-model", "anthropic");
  assert.deepEqual(footer.render(120), []);
  footer.dispose?.();
  assert.equal(disposed, true);
  assert.equal(footerCwd("/home/other", "/home/me"), "/home/other");
  assert.equal(footerCwd("/home/me", "/home/me"), "~");
});
