import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isRecord } from "./http.ts";
import type { ControlState, RequestControl } from "./request-controls.ts";

export interface ControlSettings {
  load(): ControlState | undefined;
  update(patch: ControlState, fallback: ControlState): ControlState;
}

/** Global preferences, independent of session history. Never overwrite malformed settings. */
export class FileControlSettings implements ControlSettings {
  constructor(readonly path: string, private readonly controls: readonly RequestControl[]) {}

  load(): ControlState | undefined {
    let fd: number;
    try { fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 16384) throw new Error("Invalid enhancement settings file.");
      let data: unknown;
      try { data = JSON.parse(readFileSync(fd, "utf8")); }
      catch { throw new Error("Invalid enhancement settings JSON."); }
      if (!isRecord(data) || data.version !== 1 || !isRecord(data.values)) throw new Error("Unsupported enhancement settings format.");
      const state: ControlState = {};
      for (const control of this.controls) {
        const value = data.values[control.id];
        if (typeof value !== "string" || !control.choices.includes(value)) throw new Error(`Invalid saved ${control.id} setting.`);
        state[control.id] = value;
      }
      return state;
    } finally { closeSync(fd); }
  }

  update(patch: ControlState, fallback: ControlState): ControlState {
    for (const [id, value] of Object.entries(patch)) {
      if (!this.controls.find(control => control.id === id)?.choices.includes(value)) throw new Error("Invalid enhancement setting.");
    }
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    // A short exclusive lock prevents concurrent pi processes from losing unrelated edits.
    const lockPath = `${this.path}.lock`;
    let lock: number;
    try { lock = openSync(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Settings are locked. Retry; if a previous pi process crashed, check ${lockPath}.`);
      throw error;
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const next = { ...(this.load() ?? fallback), ...patch };
      const fd = openSync(temporary, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ version: 1, values: next }, null, 2) + "\n"); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temporary, this.path);
      return next;
    } finally {
      try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      finally { closeSync(lock); unlinkSync(lockPath); }
    }
  }
}
