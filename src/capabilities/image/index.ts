import { resizeImage, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveCodexAuth } from "../../shared/auth.ts";
import { ImageArtifactStore } from "./artifacts.ts";
import { ImageClient } from "./client.ts";
import { imageTool } from "./tool.ts";

export function registerImage(pi: ExtensionAPI, artifactRoot: string): void {
  pi.registerTool(imageTool({
    artifacts: new ImageArtifactStore(artifactRoot),
    client: ctx => new ImageClient(() => resolveCodexAuth(ctx)),
    preview: (bytes, mime) => resizeImage(bytes, mime, { maxWidth: 1024, maxHeight: 1024, maxBytes: 512 * 1024 }),
  }));
}
