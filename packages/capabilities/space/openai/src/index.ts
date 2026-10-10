import { defineModule } from "../../../../core/src/module.ts";
import { definition } from "../../definition.ts";
import { appsTool } from "../../../../transports/openai/src/apps-tool.ts";
export default defineModule(
  definition,
  {
    provider: "openai",
    auth: { provider: "openai", channel: "codex", acceptedKinds: ["oauth"] },
  },
  () => ({ tool: appsTool("space") }),
);
