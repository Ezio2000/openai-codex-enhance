import { Type, type Static } from "typebox";
import { object, text, choices } from "../../shared/schema.ts";

const imageSource = object({
  path: Type.Optional(text("Local PNG/JPEG/WebP file to upload; relative to current working directory", 4096)),
  image_url: Type.Optional(text("HTTP(S) image URL, or data:image/png|jpeg|webp;base64,...; fetched by OpenAI, not this client", 70000000)),
});
export const ImageSchema = object({
  prompt: text("Detailed generation/edit instructions. For edits, state what to preserve and what to change.", 32000),
  images: Type.Optional(Type.Array(imageSource, { minItems: 1, maxItems: 16, description: "Edit/reference inputs. Exactly one of path or image_url per item. Omit to generate a new image." })),
  num_last_images_to_include: Type.Optional(Type.Integer({ minimum: 1, maximum: 16, description: "Use recent conversation images for editing; mutually exclusive with images. Saved original artifacts are preferred over previews." })),
  size: Type.Optional(text("auto or WIDTHxHEIGHT. gpt-image-2: multiples of 16, edges <=3840, ratio <=3:1, 655360–8294400 pixels.", 30)),
  background: Type.Optional(choices(["auto", "opaque", "transparent"], "Default auto; transparent PNG output is supported")),
  quality: Type.Optional(choices(["low", "medium", "high"], "Default high. Backend may adjust quality; observable mismatches are reported.")),
  moderation: Type.Optional(choices(["auto", "low"], "Default auto. Low requests less restrictive filtering, not disabled safety policies; Codex backend effect is unverified.")),
  timeout_seconds: Type.Optional(Type.Integer({ minimum: 10, maximum: 600, description: "Default 240. Image POSTs are never automatically retried." })),
});
export type ImageArgs = Static<typeof ImageSchema>;
export type ImageSource = Static<typeof imageSource>;
