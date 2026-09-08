# GPT Image 2.5 model selection

`codex_image.model` accepts `gpt-image-2.5-flare` (default), `gpt-image-2.5-sunburst`, and `gpt-image-2`. Explicit selections survive validation and HTTP serialization for generation and editing. Reload pi with `/reload` after updating the extension.

## Official documentation checked 2026-09-08

- [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst): prioritizes editing precision.
- [Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare): prioritizes fast everyday generation.
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation): both add `quality: xhigh|max`, alongside `low|medium|high|auto`; official default is `auto`. Custom sizes retain multiples-of-16, maximum edge 3840, aspect ratio 1:3–3:1, and 655360–8294400 pixels; above 2560x1440 is experimental. Supports transparent PNG/WebP, JPEG/WebP compression, masks, multiple outputs, and partial-image streaming. These are not all new to 2.5.
- Both have dated snapshots ending `-2026-09-08`. Snapshot selection is not exposed by this tool.
- Responses API usage selects a mainline model at top level and the image model inside the image-generation tool; it is not a direct conversational model.
- Token prices match GPT Image 2, but its calculator does not estimate 2.5 token consumption.

## Scope of this change

Model selection and the `auto` quality default are exposed; tool quality accepts `auto|low|medium|high` (default `auto`), and PNG, one output, SSE, zero requested partials remain fixed. `xhigh|max`, masks, compression, and input fidelity are not exposed. Follow-up Codex probes of `xhigh|max` did not honor the requested quality (see below). Public API documentation is not a guarantee of Codex endpoint compatibility.

## Live probe results

Each 2.5 model name returned HTTP 200 and a complete PNG using the same Codex OAuth endpoint, `quality: low`, on 2026-09-08. Flare took about 23.3 seconds; Sunburst about 24.4 seconds. Both returned 1370x1148 despite requesting 1024x1024. This is a single-request observation, not a speed benchmark. Responses did not report the serving model, so accepted model names do not independently prove internal routing. Editing was not live-tested. Unit tests cover model forwarding on both endpoint paths without consuming quota.

### Follow-up quality and 4K probes

Six additional single requests on 2026-09-08 (no retries): for each model, `xhigh` at 1024x1024, `max` at 1024x1024, and `high` at 3840x2160. All returned HTTP 200 and completed PNGs, but all reported `quality: low`, `size: 1370x1148`, and 429 output image tokens. PNG dimensions independently matched 1370x1148. Requests were sent directly through HTTPTransport, bypassing ImageClient defaults and tool quality validation; the requested values were not overwritten locally. Thus neither elevated quality nor the requested 4K dimensions was honored in these probes. This does not establish behavior for other accounts, public API requests, or every possible size. Internal model routing remains unverified.

Probe accepts `--quality=low|high|xhigh|max` and `--size=1024x1024|3840x2160` with an explicit `--run`. Reports and unmodified images are saved under the working project's `artifacts/image-25-probe/` in this local test setup.
