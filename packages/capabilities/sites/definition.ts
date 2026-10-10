import type { CapabilityDefinition } from "../../core/src/contracts.ts";
export const definition: CapabilityDefinition = {
  id: "sites",
  label: "Sites 查询",
  group: "Content",
  commonFields: ["action", "tool", "arguments", "timeout_seconds"],
};
