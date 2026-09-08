import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveCodexAuth } from "../../shared/auth.ts";
import { WebClient } from "./client.ts";
import { WebOutputStore } from "./output.ts";
import { webTool } from "./tool.ts";

export function registerWeb(pi: ExtensionAPI, artifactRoot: string): void {
  pi.registerTool(webTool({
    artifacts: new WebOutputStore(artifactRoot),
    client: ctx => new WebClient(() => resolveCodexAuth(ctx)),
  }));
}
