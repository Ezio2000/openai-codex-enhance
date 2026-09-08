// Explicit single-request probe. No retries, credential refresh, or credential logging.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HTTPTransport, readSSE, readJSON, isRecord, responseError } from '../src/shared/http.ts';
import { imageInfo } from '../src/capabilities/image/artifacts.ts';

async function main() {
  const model = process.argv[2] ?? "";
  if (!process.argv.includes('--run') || !['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'].includes(model)) throw Error('Specify a 2.5 model and --run (consumes quota).');
  const quality = process.argv.find(arg => arg.startsWith('--quality='))?.split('=')[1] ?? 'low';
  const size = process.argv.find(arg => arg.startsWith('--size='))?.split('=')[1] ?? '1024x1024';
  if (!['low', 'high', 'xhigh', 'max'].includes(quality) || !['1024x1024', '3840x2160'].includes(size)) throw Error('Unsupported probe quality/size');
  const credential = JSON.parse(await readFile(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'auth.json'), 'utf8'))['openai-codex'];
  if (credential?.type !== 'oauth' || credential.expires <= Date.now()) throw Error('Unexpired Codex OAuth login required.');
  const claims = JSON.parse(Buffer.from(credential.access.split('.')[1], 'base64url').toString());
  const accountId = credential.accountId ?? claims['https://api.openai.com/auth']?.chatgpt_account_id;
  if (!accountId) throw Error('Missing account ID');
  const id = randomUUID();
  const directory = join(process.cwd(), 'artifacts', 'image-25-probe', model + '-' + id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const request = { model, prompt: 'A small red ceramic teapot on a pale blue tabletop, soft studio light, clean illustration, no text.', n: 1, size, output_format: 'png', quality, moderation: 'auto', background: 'opaque', stream: true, partial_images: 0 };
  const report: Record<string, unknown> = { request, startedAt: new Date().toISOString(), events: [] };
  const start = Date.now();
  const http = new HTTPTransport(async () => ({ baseUrl: 'https://chatgpt.com/backend-api/codex/', headers: { Authorization: `Bearer ${credential.access}`, 'chatgpt-account-id': accountId, originator: 'pi' } }));
  try {
    let saved = false;
    async function save(data: unknown) {
      if (!isRecord(data)) return;
      if (data.error) throw responseError(data, 200);
      const { b64_json, data: images, ...metadata } = data;
      (report.events as unknown[]).push(metadata);
      const base64 = typeof b64_json === 'string' ? b64_json : Array.isArray(images) && isRecord(images[0]) ? images[0].b64_json : undefined;
      if (typeof base64 === 'string') {
        const bytes = Buffer.from(base64, 'base64');
        report.image = imageInfo(bytes);
        await writeFile(join(directory, 'image.png'), bytes, { mode: 0o600 });
        saved = true;
      }
    }
    await http.post('images/generations', request, { timeoutMs: 600000, headers: { 'x-codex-image-turn-id': id }, consume: async (response, signal, requestId) => {
      report.httpStatus = response.status; report.requestId = requestId;
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        for await (const event of readSSE(response, 192 * 1024 * 1024, signal)) await save(event.data);
      } else await save(await readJSON(response, 128 * 1024 * 1024, signal));
    } });
    if (!saved) throw Error('No final image returned');
    report.status = 'completed';
  } catch (error) {
    report.status = 'failed'; report.error = error instanceof Error ? error.message : 'Unknown failure';
  }
  report.elapsedMs = Date.now() - start;
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, directory }, null, 2));
}
main().catch(() => { console.error('Probe initialization failed; check login/filesystem. No retry.'); process.exitCode = 1; });
