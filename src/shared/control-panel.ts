import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, SelectList, Text, matchesKey, type SettingItem } from "@earendil-works/pi-tui";
import type { ControlState, RequestControl } from "./request-controls.ts";
import type { ControlManagement } from "./control-management.ts";

export async function showControlPanel(
  ctx: ExtensionContext,
  controls: readonly RequestControl[],
  state: () => ControlState,
  save: (id: string, value: string) => string,
  onOpen: (close: () => void) => void,
  selected?: string,
  management: readonly ControlManagement[] = [],
  run?: (id: string, action: string) => Promise<string>,
): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    let closed = false;
    const close = () => { closed = true; done(); };
    onOpen(close);
    const container = new Container();
    container.addChild(new Text("OpenAI Codex enhancements\n↑/↓ select · Space change & save / open · Enter open · Esc back/close", 1, 1));
    const feedback = new Text("Changes are saved immediately for future sessions and restarts.", 1, 1);
    const items: SettingItem[] = controls.map(control => ({
      id: control.id,
      label: control.id,
      currentValue: state()[control.id]!,
      values: [...control.choices],
      description: [control.description, control.enabledNotice,
        ctx.model?.provider === "openai-codex" && ctx.model.api === "openai-codex-responses" && control.supported(ctx.model)
          ? "" : "Inactive for the current provider/API/model (n/a); saved as a preset."].filter(Boolean).join(" "),
    }));
    for (const section of management) items.push({
      id: section.id, label: section.label, currentValue: "manage…",
      description: "Session-only operations; not saved as global preferences. Enter/Space to open.",
      submenu: (_value, back) => {
        let busy = false;
        let left = false;
        feedback.setText(section.status());
        const menu = new SelectList(section.actions.map(a => ({ value: a.id, label: a.id, description: a.description })), section.actions.length, {
          selectedPrefix: t => theme.fg("accent", t), selectedText: t => theme.fg("accent", t),
          description: t => theme.fg("muted", t), scrollInfo: t => theme.fg("dim", t), noMatch: t => theme.fg("warning", t),
        });
        menu.onCancel = () => { left = true; back(); };
        menu.onSelect = item => {
          if (closed || left || busy || !run) return;
          busy = true;
          feedback.setText(`Computer Use: ${item.value}…`);
          void run(section.id, item.value).then(text => {
            if (!closed) feedback.setText(text);
          }, error => {
            if (!closed) feedback.setText(`Failed: ${(error as Error).message}`);
          }).finally(() => { busy = false; if (!closed) tui.requestRender(); });
        };
        return menu;
      },
    });
    const list = new SettingsList(items, items.length, getSettingsListTheme(), (id, value) => {
      // SettingsList changes its local value first. Always reconcile with successfully saved state.
      feedback.setText(save(id, value));
      for (const control of controls) list.updateValue(control.id, state()[control.id]!);
      tui.requestRender();
    }, close, { enableSearch: false });
    if (selected) list.selectItem(selected);
    container.addChild(list);
    container.addChild(feedback);
    return {
      render: width => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput(data) { if (closed) return; list.handleInput(matchesKey(data, "space") ? " " : data); tui.requestRender(); },
    };
  });
}
