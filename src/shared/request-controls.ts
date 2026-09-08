import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./http.ts";
import { FileControlSettings, type ControlSettings } from "./control-settings.ts";
import { codexCommandAutocomplete } from "./control-autocomplete.ts";
import { showControlPanel } from "./control-panel.ts";
import { createControlFooter } from "./control-footer.ts";
import type { ControlManagement } from "./control-management.ts";

export interface RequestControl {
  id: string;
  choices: readonly string[];
  description: string;
  aliases?: Readonly<Record<string, string>>;
  enabledNotice?: string;
  formatValue?(value: string, model: NonNullable<ExtensionContext["model"]>): string;
  supported(model: NonNullable<ExtensionContext["model"]>): boolean;
  transform(payload: Record<string, unknown>, value: string): Record<string, unknown>;
}
export type ControlState = Record<string, string>;
export const CONTROL_COMMAND = "openai-codex-enhance";
export const CONTROL_ENTRY = "openai-codex-enhance:request-settings";
export const CONTROL_STATUS = "openai-codex-enhance:request-settings";

export function isCodexRequestContext(ctx: Pick<ExtensionContext, "model">): boolean {
  return ctx.model?.provider === "openai-codex" && ctx.model.api === "openai-codex-responses";
}
export function defaultControlState(controls: readonly RequestControl[]): ControlState {
  return Object.fromEntries(controls.map(control => [control.id, "off"]));
}
/** Read old session-only settings once, for migration when no global preferences exist. */
export function restoreControlState(controls: readonly RequestControl[], entries: readonly unknown[]): ControlState {
  const state = defaultControlState(controls);
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== CONTROL_ENTRY || !isRecord(entry.data)) continue;
    if (entry.data.version !== 1 || !isRecord(entry.data.values)) continue;
    for (const control of controls) {
      const value = entry.data.values[control.id];
      if (typeof value === "string" && control.choices.includes(value)) state[control.id] = value;
    }
  }
  return state;
}
export function transformControlledRequest(payload: unknown, ctx: Pick<ExtensionContext, "model">, controls: readonly RequestControl[], state: ControlState): unknown {
  if (!isCodexRequestContext(ctx) || !isRecord(payload) || !Array.isArray(payload.input) || payload.model !== ctx.model!.id) return payload;
  let result = payload;
  for (const control of controls) {
    const value = state[control.id] ?? "off";
    if (value !== "off" && control.choices.includes(value) && control.supported(ctx.model!)) result = control.transform(result, value);
  }
  return result;
}
export function controlStatus(ctx: Pick<ExtensionContext, "model">, controls: readonly RequestControl[], state: ControlState): string {
  return "Codex | " + controls.map(control => {
    const value = state[control.id] ?? "off";
    const unavailable = value !== "off" && (!isCodexRequestContext(ctx) || !control.supported(ctx.model!));
    const display = ctx.model && control.formatValue ? control.formatValue(value, ctx.model) : value;
    return `${control.id}:${display}${unavailable ? "(n/a)" : ""}`;
  }).join(" | ");
}

export function registerRequestControls(pi: ExtensionAPI, controls: readonly RequestControl[], settings: ControlSettings = new FileControlSettings(join(getAgentDir(), "openai-codex-enhance.json"), controls), management: readonly ControlManagement[] = []): void {
  let state = defaultControlState(controls);
  let latestContext: ExtensionContext | undefined;
  let latestModel: ExtensionContext["model"];
  let epoch = 0;
  let disposed = false;
  let wrappedAutocomplete = false;
  let footerInstalled = false;
  let closePanel: (() => void) | undefined;
  const byId = new Map(controls.map(control => [control.id, control]));
  const managers = new Map(management.map(section => [section.id, section]));
  const visible = () => !disposed && latestModel?.provider === "openai-codex";
  const usage = `/${CONTROL_COMMAND} [verbosity | image-detail | fast] [value], or status${management.length ? `; ${management.map(m => `${m.id} [${m.actions.map(a => a.id).join(" | ")}]`).join("; ")}` : ""}. No value opens the Space-toggle settings panel (TUI only).`;
  const close = () => { epoch++; const callback = closePanel; closePanel = undefined; callback?.(); };
  const report = (ctx: ExtensionContext, text: string, level: "info" | "warning" | "error" = "info") => {
    if (ctx.hasUI) ctx.ui.notify(text, level);
    else if (level === "error") throw new Error(text);
  };
  const refreshFooter = (ctx: ExtensionContext) => {
    // Keep pi's live ExtensionContext intact: its thinkingLevel is a getter that changes after Shift+Tab.
    latestContext = ctx;
    const statusContext = { model: latestModel };
    if (ctx.hasUI) ctx.ui.setStatus(CONTROL_STATUS, visible() ? controlStatus(statusContext, controls, state) : undefined);
    if (ctx.mode === "tui") {
      if (visible() && !footerInstalled) {
        ctx.ui.setFooter(createControlFooter(
          () => latestContext,
          () => controlStatus({ model: latestModel }, controls, state),
          CONTROL_STATUS,
          () => latestModel,
        ));
        footerInstalled = true;
      } else if (!visible() && footerInstalled) {
        ctx.ui.setFooter(undefined);
        footerInstalled = false;
      }
    }
  };
  const updateFooter = (ctx: ExtensionContext, model: ExtensionContext["model"] = ctx.model) => {
    latestModel = model;
    refreshFooter(ctx);
  };
  const load = (ctx: ExtensionContext, migrate = false): boolean => {
    try {
      const stored = settings.load();
      if (stored) state = stored;
      else {
        const entries = migrate ? ctx.sessionManager.getBranch() : [];
        const legacy = restoreControlState(controls, entries);
        const hasLegacy = entries.some(entry => entry.type === "custom" && entry.customType === CONTROL_ENTRY
          && isRecord(entry.data) && entry.data.version === 1 && isRecord(entry.data.values));
        state = hasLegacy ? settings.update(legacy, legacy) : legacy;
      }
      updateFooter(ctx);
      return true;
    } catch {
      report(ctx, "Cannot load enhancement settings. Previous values retained; check openai-codex-enhance.json (it has not been overwritten).", "error");
      return false;
    }
  };
  const save = (ctx: ExtensionContext, control: RequestControl, value: string): string => {
    // The store merges under a cross-process lock, atomically renames, and returns only after saving.
    state = settings.update({ [control.id]: value }, state);
    refreshFooter(ctx);
    const applicable = isCodexRequestContext(ctx) && control.supported(ctx.model!);
    return [`Saved ${control.id}: ${value} (future sessions and restarts).`,
      value !== "off" && !applicable ? "Inactive for this API/model (n/a)." : "",
      value !== "off" ? control.enabledNotice : "No override; pi/other extensions may still set this field.",
    ].filter(Boolean).join("\n");
  };
  pi.on("session_start", (_event, ctx) => {
    disposed = false;
    close();
    updateFooter(ctx);
    if (ctx.mode === "tui" && !wrappedAutocomplete) {
      ctx.ui.addAutocompleteProvider(current => codexCommandAutocomplete(current, () => !disposed));
      wrappedAutocomplete = true;
    }
    load(ctx, true);
  });
  pi.on("session_tree", (_event, ctx) => { close(); updateFooter(ctx); });
  pi.on("model_select", (event, ctx) => { close(); updateFooter(ctx, event.model ?? ctx.model); });
  pi.on("thinking_level_select", (_event, ctx) => refreshFooter(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    disposed = true;
    close();
    latestContext = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(CONTROL_STATUS, undefined);
    if (footerInstalled && ctx.mode === "tui") ctx.ui.setFooter(undefined);
    footerInstalled = false;
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (disposed) return;
    // In-flight requests can carry an older model context; never let them resurrect footer visibility.
    const payload = transformControlledRequest(event.payload, ctx, controls, state);
    if (payload !== event.payload) return payload;
  });
  pi.registerCommand(CONTROL_COMMAND, {
    description: "Enhancement settings and Computer Use on every provider; Space to change, Esc to close",
    getArgumentCompletions: prefix => {
      if (disposed) return null;
      const input = prefix.trimStart().toLowerCase();
      const match = /^(\S+)\s+(.*)$/.exec(input);
      const control = match ? byId.get(match[1]!) : undefined;
      const section = match ? managers.get(match[1]!) : undefined;
      // Command access is provider-independent; only request transforms are Codex-gated.
      const values = match
        ? section ? section.actions.map(action => `${section.id} ${action.id}`)
          : control ? control.choices.map(value => `${control.id} ${value}`) : []
        : [...byId.keys(), ...managers.keys(), "status"];
      const items = values.filter(value => value.startsWith(input)).map(value => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      if (disposed) return;
      latestContext = ctx;
      const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length > 2 || (words[0] && words[0] !== "status" && !byId.has(words[0]) && !managers.has(words[0]))) { report(ctx, usage, "error"); return; }
      const section = words[0] ? managers.get(words[0]) : undefined;
      if (section && words[1]) {
        if (!section.actions.some(a => a.id === words[1])) { report(ctx, usage, "error"); return; }
        close();
        const stamp = epoch;
        try {
          const result = await section.run(words[1], ctx);
          if (stamp === epoch) report(ctx, result);
        } catch (error) { if (stamp === epoch) report(ctx, (error as Error).message, "error"); }
        return;
      }
      if (!load(ctx)) return;
      if (words[0] === "status") {
        if (words.length !== 1) { report(ctx, usage, "error"); return; }
        report(ctx, `${controlStatus(ctx, controls, state)}\nSaved global preferences, not confirmed backend behavior.${management.map(m => `\n\n${m.status()}`).join("")}`);
        return;
      }
      const control = words[0] ? byId.get(words[0]) : undefined;
      if (words[1] !== undefined && control) {
        const raw = words[1];
        const value = control.aliases && Object.hasOwn(control.aliases, raw) ? control.aliases[raw]! : raw;
        if (!control.choices.includes(value)) { report(ctx, `Invalid ${control.id}; choose ${control.choices.join(" / ")}.`, "error"); return; }
        try { report(ctx, save(ctx, control, value)); }
        catch (error) { report(ctx, `Not saved: ${(error as Error).message}`, "error"); }
        return;
      }
      if (ctx.mode !== "tui") { report(ctx, usage, "error"); return; }
      close();
      const stamp = epoch;
      try {
        await showControlPanel(ctx, controls, () => state, (id, value) => {
          if (disposed || epoch !== stamp) return "Panel closed; no changes saved.";
          try { return save(latestContext!, byId.get(id)!, value); }
          catch (error) { return `Not saved: ${(error as Error).message}`; }
        }, callback => { closePanel = callback; }, control?.id ?? section?.id, management, async (id, action) => {
          if (disposed || epoch !== stamp) return "Panel closed; no action performed.";
          return managers.get(id)!.run(action, latestContext!);
        });
      } finally {
        if (epoch === stamp) { closePanel = undefined; epoch++; }
      }
    },
  });
}
