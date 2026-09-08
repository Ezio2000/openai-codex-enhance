// Explicit local GUI smoke test. Does not run during npm test.
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ComputerSession } from "../src/capabilities/computer/session.ts";
import { ComputerOutput } from "../src/capabilities/computer/output.ts";

if (!process.argv.includes("--allow-calculator")) {
  throw new Error("This test reads/launches Calculator and captures its window. Run with --allow-calculator to authorize this app for this test only.");
}
// Keep this opt-in smoke restricted to its explicit Calculator grant, independent of defaults.
const session = new ComputerSession(undefined, "ask");
const output = new ComputerOutput(join(process.cwd(), "artifacts", "computer-smoke"));
const id = randomUUID();
try {
  for (const [index, code] of [
    'var smokeApp = await cua.getApp("com.apple.calculator");',
    'await smokeApp.getScreenshot();',
    'await smokeApp.getAXState({disableDiffing:true});',
  ].entries()) {
    const start = performance.now();
    const result = await session.run({
      code, title: "Read Calculator smoke test", timeoutMs: 60_000, callId: `${id}-${index}`,
      sessionId: id, model: "gpt-6-astra",
      choose: async (title, choices) => title.split("\n").includes("App: com.apple.calculator") && choices.includes("Allow this app for this pi session")
        ? "Allow this app for this pi session" : "Deny",
    });
    const formatted = await output.format(id, result);
    if (index === 0 && !result.isError) {
      const text = formatted.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      assert.match(text, /pi bridge capabilities \(computer-only\)/);
      assert.doesNotMatch(text, /interface Browser|interface Tab|type BrowserInfo/);
      assert.match(text, /# Computer Use Confirmations Policy/);
    }
    console.log(JSON.stringify({ call: index + 1, elapsedMs: Math.round(performance.now() - start), ...session.status(), ...formatted.details }));
    if (result.isError) throw new Error(formatted.content.filter(b => b.type === "text").map(b => b.text).join("\n"));
  }
  const generation = session.status().generation;
  await session.endTurn();
  console.log("After turn cleanup:", session.status());
  assert.equal(session.status().connected, false);
  assert.deepEqual(session.status().approvedApps, ["com.apple.calculator"]);
  const next = await session.run({
    code: 'var smokeApp = await cua.getApp("com.apple.calculator");',
    title: "Read Calculator in next run", timeoutMs: 60_000, callId: `${id}-next`, sessionId: id, model: "gpt-6-astra",
    choose: async () => { throw new Error("Unexpected repeated app approval"); },
  });
  const nextOutput = await output.format(id, next);
  if (next.isError) throw new Error(nextOutput.content.filter(b => b.type === "text").map(b => b.text).join("\n"));
  assert.notEqual(session.status().generation, generation);
  await session.endTurn();
  assert.equal(session.status().connected, false);
  console.log("Next run recreated the runtime, reused the app grant, then disconnected.");
} finally { await session.reset(); }
