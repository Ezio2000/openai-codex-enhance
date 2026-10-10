import type { CapabilityDefinition } from "../../core/src/contracts.ts";
export const definition: CapabilityDefinition = {
  id: "space",
  label: "Space 页面",
  group: "Content",
  commonFields: ["action", "tool", "arguments", "timeout_seconds"],
};
