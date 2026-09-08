import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isRecord } from "./http.ts";

type FooterFactory = NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]>;
const compact = (n: number) => n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(1)}m`;
export function footerCwd(cwd: string, home = homedir()): string {
  const rel = relative(home, cwd);
  return !rel ? "~" : rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? `~${sep}${rel}` : cwd;
}

/** Public setFooter API: cwd + controls in one dim-grey line, ordinary stats beneath. */
export function createControlFooter(
  context: () => ExtensionContext | undefined,
  label: () => string,
  statusKey: string,
  selectedModel: () => ExtensionContext["model"] = () => context()?.model,
): FooterFactory {
  return (tui, theme, data) => ({
    dispose: data.onBranchChange(() => tui.requestRender()),
    invalidate() {},
    render(width) {
      const ctx = context();
      const model = selectedModel();
      // Also gate during render: an old render callback must not show a stale Codex UI.
      if (!ctx || model?.provider !== "openai-codex") return [];
      const clean = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, " ");
      const branch = data.getGitBranch();
      const name = ctx.sessionManager.getSessionName();
      const path = footerCwd(ctx.cwd);
      const controls = label().replace(/^Codex \| /, "").replaceAll(" | ", "  ").replace("image-detail:", "image:");
      const first = `${path}  ${controls}${branch ? ` (${branch})` : ""}${name ? ` • ${name}` : ""}`;
      const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      let latestCacheHit: number | undefined;
      for (const entry of ctx.sessionManager.getEntries()) {
        const usage: unknown = entry.type === "message" && "usage" in entry.message ? entry.message.usage
          : "usage" in entry ? entry.usage : undefined;
        if (!isRecord(usage)) continue;
        for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) if (typeof usage[key] === "number") totals[key] += usage[key];
        if (isRecord(usage.cost) && typeof usage.cost.total === "number") totals.cost += usage.cost.total;
        if (entry.type === "message" && entry.message.role === "assistant") {
          const input = Number(usage.input ?? 0), read = Number(usage.cacheRead ?? 0), write = Number(usage.cacheWrite ?? 0);
          latestCacheHit = input + read + write > 0 ? read / (input + read + write) * 100 : undefined;
        }
      }
      const contextUsage = ctx.getContextUsage();
      const percent = contextUsage?.percent == null ? "?" : contextUsage.percent.toFixed(1);
      const left = `↑${compact(totals.input)} ↓${compact(totals.output)} R${compact(totals.cacheRead)} W${compact(totals.cacheWrite)}${latestCacheHit === undefined ? "" : ` CH${latestCacheHit.toFixed(1)}%`} $${totals.cost.toFixed(3)} (sub) ${percent}%/${compact(model.contextWindow)}`;
      const right = `${model.id}${ctx.thinkingLevel ? ` • ${ctx.thinkingLevel}` : ""}`;
      const available = Math.max(0, width - visibleWidth(left) - 2);
      const modelText = truncateToWidth(right, available, "");
      const stats = left + " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(modelText))) + modelText;
      const lines = [first, stats].map(line => theme.fg("dim", truncateToWidth(clean(line), width)));
      // Preserve other extensions' status text, but do not duplicate our controls on a third row.
      const others = [...data.getExtensionStatuses()].filter(([key]) => key !== statusKey).sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text);
      if (others.length) lines.push(truncateToWidth(others.join(" "), width));
      return lines;
    },
  });
}
