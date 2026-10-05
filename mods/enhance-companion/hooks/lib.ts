/** Short labels for cc-enhance capability names in the status line. */
export const SHORT_TOOL: Record<string, string> = {
  gen_image: 'image',
  gen_video: 'video',
  gen_voice: 'voice',
  search_web: 'web',
  view_image: 'see',
  view_pdf: 'pdf',
  view_video: 'watch',
  use_computer: 'computer',
}

/**
 * Parses `cc-enhance.mjs cli status` output: connection lines end in
 * `· configured`, capability lines read `gen_image/xai @ pi:xai: available`.
 */
export function parseStatus(stdout: string): { caps: string[]; connections: number } {
  const caps = new Set<string>()
  let connections = 0
  for (const line of stdout.split('\n')) {
    if (line.trimEnd().endsWith('· configured')) connections += 1
    const match = line.match(/^(\w+)\/\w+ @ .+: available\s*$/)
    const name = match?.[1]
    if (name) caps.add(SHORT_TOOL[name] ?? name)
  }
  return { caps: [...caps], connections }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatTime(mtimeMs: number): string {
  const d = new Date(mtimeMs)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
