export const IMAGE_FIXED = Object.freeze({
  model: "gpt-image-2", n: 1, output_format: "png", stream: true, partial_images: 0,
} as const);
export const IMAGE_DEFAULTS = Object.freeze({ ...IMAGE_FIXED, quality: "high", moderation: "auto" } as const);
export interface ImageReference { image_url: string }
export interface ImageRequest {
  model: "gpt-image-2";
  prompt: string;
  images?: ImageReference[];
  n?: 1;
  size?: string;
  quality?: "low" | "medium" | "high";
  background?: "transparent" | "opaque" | "auto";
  output_format?: "png";
  moderation?: "auto" | "low";
  stream?: true;
  partial_images?: 0;
}
export interface ImageResponse {
  /** Client-side compatibility notices, not sent on the wire. */
  warnings?: string[];
  created?: number;
  data: { b64_json: string; revised_prompt?: string }[];
  output_format?: string;
  background?: string;
  quality?: string;
  size?: string;
  usage?: Record<string, unknown>;
}
export type ImageProgress = (event: { index?: number; b64_json?: string; output_format?: string }) => void;
