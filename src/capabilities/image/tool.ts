import { readFile } from "node:fs/promises";
import { Value } from "typebox/value";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ImageArtifactStore, MAX_TOTAL_INPUT_BYTES, resolveImage } from "./artifacts.ts";
import { ImageClient } from "./client.ts";
import { IMAGE_DEFAULTS, type ImageRequest } from "./types.ts";
import { validateImageRequest } from "./validation.ts";
import { imageWarnings } from "./warnings.ts";
import { ImageSchema, type ImageArgs } from "./schema.ts";

type Details = Record<string, unknown>;
interface Preview { data: string; mimeType: string }
export interface ImageDependencies {
  client(ctx: ExtensionContext): ImageClient;
  artifacts: ImageArtifactStore;
  preview?(bytes: Uint8Array, mimeType: string): Promise<Preview | null>;
}

export function imageWireOptions(args: ImageArgs): ImageRequest {
  return {
    ...IMAGE_DEFAULTS, prompt: args.prompt,
    size: args.size ?? "auto", background: args.background ?? "auto",
    quality: args.quality ?? IMAGE_DEFAULTS.quality, moderation: args.moderation ?? IMAGE_DEFAULTS.moderation,
  };
}

export function imageTool(deps: ImageDependencies): ToolDefinition<typeof ImageSchema, Details> {
  return {
    name: "codex_image", label: "OpenAI Image",
    description: "Generate or edit images with OpenAI GPT Image over the Codex HTTP endpoint. No images means generation; explicit images means editing. Conversation context images are never read, so every request is independent. Supports local paths, image URLs/data URLs, size, background, quality and moderation. Quality defaults to high and moderation to auto. Moderation low does not disable safety policies and its Codex backend effect is unverified. Fixed internally: gpt-image-2, one image, PNG, SSE with no requested partial images. These defaults are not tool arguments. Requested dimensions may not be honored; observable mismatches are reported. Input files must be PNG/JPEG/WebP under 50 MB each, at most 16 images and 100 MiB combined. Inspect local reference images with read before editing. Specify exactly one image source per item. Preserve unchanged details explicitly in the prompt. Generated originals are saved locally, with at most 4 small previews returned. Reuse original saved paths for later edits. Requests can take several minutes, consume image quota, and are never automatically retried.",
    promptSnippet: "Generate/edit images using OpenAI GPT Image, including reference images",
    promptGuidelines: ["Use codex_image for requested image generation or editing. Prefer saved original image paths for follow-up edits; do not claim an image was produced if the tool failed."],
    parameters: ImageSchema,
    async execute(callId, args, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!Value.Check(ImageSchema, args)) throw new Error("Invalid codex_image arguments; unsupported or fixed parameters are rejected and this build never reads conversation context images. Use the current tool schema.");
      // Context images are deliberately never read: pass explicit independent references, or generate without references.
      const sources = args.images ?? [];
      // Resolve sequentially so a batch cannot trigger unbounded parallel file reads.
      const resolved = [];
      let inputBytes = 0;
      for (const source of sources) {
        const image = await resolveImage(source, ctx.cwd, signal);
        inputBytes += image.bytes?.length ?? 0;
        if (inputBytes > MAX_TOTAL_INPUT_BYTES) throw new Error("Combined image inputs exceed the 100 MiB safety limit.");
        resolved.push(image);
      }
      const request: ImageRequest = { ...imageWireOptions(args), images: resolved.length ? resolved.map(image => image.reference) : undefined };
      validateImageRequest(request);
      onUpdate?.({ content: [{ type: "text", text: `${request.images ? "Editing" : "Generating"} image(s) with ${request.model}…` }], details: { status: "in_progress" } });
      const result = await deps.client(ctx).images(request, {
        signal, timeoutMs: (args.timeout_seconds ?? 240) * 1000, turnId: callId,
        onProgress: progress => onUpdate?.({
          content: [{ type: "text", text: `Received partial image${progress.index !== undefined ? ` ${progress.index + 1}` : ""}; waiting for the final image…` }],
          details: { status: "in_progress", partialImageIndex: progress.index },
        }),
      });
      signal?.throwIfAborted();
      const images = await deps.artifacts.saveImages(ctx.sessionManager.getSessionId(), result.data.data, signal);
      const warnings = imageWarnings(request, result.data, images);
      const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{
        type: "text", text: images.map((image, i) => `Image ${i + 1}: ${image.path}${image.width ? ` (${image.width}x${image.height})` : ""}`).join("\n") + "\nOriginal files are saved. Previews may be resized; use original paths for subsequent edits." + (warnings.length ? `\n\nBackend compatibility warnings:\n${warnings.map(warning => `- ${warning}`).join("\n")}` : ""),
      }];
      if (deps.preview) {
        for (const image of images.slice(0, 4)) {
          signal?.throwIfAborted();
          try {
            const preview = await deps.preview(await readFile(image.path, { signal }), image.mimeType);
            if (preview && Buffer.byteLength(preview.data, "base64") <= 512 * 1024) content.push({ type: "image", ...preview });
          } catch {
            signal?.throwIfAborted();
            // A preview failure must not discard a successfully saved image.
          }
        }
      }
      return {
        content,
        details: { version: 1, status: "completed", model: request.model, operation: request.images ? "edit" : "generate", requestId: result.requestId, images, warnings,
          outputFormat: result.data.output_format, quality: result.data.quality, background: result.data.background, size: result.data.size, usage: result.data.usage },
      };
    },
  };
}
