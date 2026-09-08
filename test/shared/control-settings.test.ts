import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { FileControlSettings } from "../../src/shared/control-settings.ts";
import { defaultControlState } from "../../src/shared/request-controls.ts";
import { controls } from "../request-control-helpers.ts";

test("preferences are private, atomic, merge updates and can be loaded by a new Node process", t => {
  const dir = mkdtempSync(join(tmpdir(), "codex-preferences-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "settings.json");
  const store = new FileControlSettings(path, controls);
  const defaults = defaultControlState(controls);
  assert.equal(store.load(), undefined);
  store.update({ verbosity: "high" }, defaults);
  // A stale second instance must merge, not erase the first instance's setting.
  new FileControlSettings(path, controls).update({ fast: "on" }, defaults);
  assert.deepEqual(store.load(), { ...defaults, verbosity: "high", fast: "on" });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ["settings.json"]);
  const script = `import {FileControlSettings} from ${JSON.stringify(new URL("../../src/shared/control-settings.ts", import.meta.url).href)};
    import {controls} from ${JSON.stringify(new URL("../request-control-helpers.ts", import.meta.url).href)};
    process.stdout.write(JSON.stringify(new FileControlSettings(process.argv[1],controls).load()));`;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path], { encoding: "utf8", cwd: new URL("../../", import.meta.url), timeout: 15000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), store.load());
});

test("malformed files and conflicting locks never get silently overwritten", t => {
  const dir = mkdtempSync(join(tmpdir(), "codex-preferences-error-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "settings.json");
  const store = new FileControlSettings(path, controls);
  const defaults = defaultControlState(controls);
  for (const text of ["{invalid", JSON.stringify({ version: 2, values: defaults }), JSON.stringify({ version: 1, values: { ...defaults, fast: "invalid" } })]) {
    writeFileSync(path, text);
    assert.throws(() => store.load());
    assert.throws(() => store.update({ fast: "on" }, defaults));
    assert.equal(readFileSync(path, "utf8"), text);
    assert.deepEqual(readdirSync(dir), ["settings.json"]);
  }
  rmSync(path);
  writeFileSync(`${path}.lock`, "another writer");
  assert.throws(() => store.update({ fast: "on" }, defaults), /locked/);
  assert.equal(readFileSync(`${path}.lock`, "utf8"), "another writer");
});
