import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Session operations, deliberately separate from persisted request preferences. */
export interface ControlManagement {
  id: string;
  label: string;
  status(): string;
  actions: readonly { id: string; description: string }[];
  run(action: string, ctx: ExtensionContext): Promise<string>;
}
