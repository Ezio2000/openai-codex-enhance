export type Artifact = {
  /** Absolute path of the generated file. */
  path: string
  /** Capability that produced it, e.g. `gen_image`. */
  tool: string
  /** Provider short name, e.g. `xai`. */
  provider: string
  /** File name inside the call directory. */
  file: string
  /** Modification time in milliseconds since the epoch. */
  mtimeMs: number
  /** Size in bytes. */
  size: number
}

/** Connection status drawn above the prompt: what is available, or why not. */
export type Status = { caps: string[]; connections: number } | { error: string }

declare module 'claude-code' {
  interface PluginState {
    'enhance-companion': { artifacts: Artifact[]; status: Status | null }
  }
}
