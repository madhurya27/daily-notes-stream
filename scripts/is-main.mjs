/**
 * Lets a script tell whether Node ran it or another script imported it. Uses
 * only Node's own modules, so scripts that run without packages can import it.
 */
import { resolve } from "path";
import { fileURLToPath } from "url";

/** True when this module is the file Node was asked to run, not an import. */
export function isMain(moduleUrl) {
    return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(moduleUrl);
}
