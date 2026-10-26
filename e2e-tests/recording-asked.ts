/**
 * Whether this run makes a README recording. Only the `capture:recording`
 * commands ask for one.
 */
export function recordingAsked(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.CAPTURE_RECORDING === "1";
}
