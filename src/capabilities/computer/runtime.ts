import { access, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface Runtime {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  dispose(): Promise<void>;
}

// User-configured application bundle only; never discover executables from the project.
export async function officialRuntime(): Promise<Runtime> {
  if (process.platform !== "darwin") throw new Error("codex_computer currently supports macOS only.");
  const app = process.env.OPENAI_CODEX_COMPUTER_APP ?? "/Applications/ChatGPT.app";
  if (!isAbsolute(app)) throw new Error("OPENAI_CODEX_COMPUTER_APP must be an absolute application path.");
  const resources = join(await realpath(app), "Contents", "Resources");
  const root = join(resources, "cua_node");
  const node = join(root, "bin", "node");
  const repl = join(root, "bin", "node_repl");
  const codex = join(resources, "codex");
  const modules = join(root, "lib", "node_modules");
  const launcher = join(resources, "plugins", "openai-bundled", "plugins", "unified-computer-use", "scripts", "launch.mjs");
  try {
    await Promise.all([access(node, constants.X_OK), access(repl, constants.X_OK), access(codex, constants.X_OK), access(launcher), access(join(modules, "@oai", "sky")), access(join(modules, "@oai", "cua"))]);
  } catch {
    throw new Error(`Official Computer Use runtime not found in ${app}. Install a compatible ChatGPT desktop app; no runtime is downloaded automatically.`);
  }
  const cwd = await mkdtemp(join(tmpdir(), "pi-codex-computer-"));
  try { await symlink(modules, join(cwd, "node_modules"), "dir"); }
  catch (error) { await rm(cwd, { recursive: true, force: true }); throw error; }
  // Do not forward OAuth credentials, NODE_OPTIONS, loader injection, or safety-override flags.
  const env: NodeJS.ProcessEnv = {
    HOME: homedir(), TMPDIR: tmpdir(), PATH: `${join(root, "bin")}:${resources}:/usr/bin:/bin:/usr/sbin:/sbin`,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    CODEX_CLI_PATH: codex,
    CUA_REPL_NODE_REPL_PATH: repl, CUA_REPL_ENABLED_SURFACES: "computer",
    NODE_REPL_NODE_PATH: node, NODE_REPL_NODE_MODULE_DIRS: modules,
    NODE_REPL_TRUSTED_CODE_PATHS: modules,
  };
  return { command: node, args: [launcher], cwd, env, dispose: () => rm(cwd, { recursive: true, force: true }) };
}
