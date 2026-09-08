import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWeb } from "./capabilities/web/index.ts";
import { registerImage } from "./capabilities/image/index.ts";
import { registerComputer } from "./capabilities/computer/index.ts";
import { verbosityControl } from "./capabilities/verbosity/index.ts";
import { imageDetailControl } from "./capabilities/image-detail/index.ts";
import { fastControl } from "./capabilities/fast/index.ts";
import { registerRequestControls } from "./shared/request-controls.ts";

export default function openaiCodexEnhance(pi: ExtensionAPI): void {
  const root = join(getAgentDir(), "artifacts", "openai-codex-enhance");
  registerWeb(pi, join(root, "web"));
  registerImage(pi, join(root, "image"));
  const computer = registerComputer(pi, join(root, "computer"));
  registerRequestControls(pi, [verbosityControl, imageDetailControl, fastControl], undefined, [computer]);
  const tools = ["codex_web", "codex_image", "codex_computer"];
  // Web/image use stored Codex OAuth; computer uses the local official runtime.
  // All tools are independent of the main model's provider; prerequisites are checked at execution.
  const activate = () => {
    const active = pi.getActiveTools().filter(name => !tools.includes(name));
    pi.setActiveTools([...active, ...tools]);
  };
  pi.on("session_start", activate);
  pi.on("model_select", activate);
}
