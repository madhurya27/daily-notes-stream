/**
 * Whether this run makes a README recording. Only the `capture:recording`
 * commands ask for one.
 */
export function recordingAsked(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.CAPTURE_RECORDING === "1";
}

/**
 * Whether this run takes the README's screenshots. Only the
 * `capture:screenshots` commands ask for them.
 */
export function screenshotsAsked(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.CAPTURE_SCREENSHOTS === "1";
}
