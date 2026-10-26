import { existsSync, readFileSync } from "fs";
import { parseEnv } from "util";

/**
 * This Mac's settings for a phone run, from a gitignored file. The command line
 * wins over the file.
 */
export function loadLocalEnv(file: string, env: NodeJS.ProcessEnv = process.env): void {
    if (!existsSync(file)) return;
    for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) env[name] ??= value;
}
