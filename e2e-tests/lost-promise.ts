/**
 * Now and then on Linux CI, Chromium throws away the promise of a startup
 * step's `page.evaluate` before it settles. Why is not known (docs/TODO.md).
 */
const LOST = "Resulting promise was garbage collected.";

/**
 * Runs `step`, and once more if Chromium lost its promise, with a GitHub
 * warning so CI shows how often that happens. Use it only for a step that is
 * safe to run twice.
 */
export async function retryLostPromise<T>(
    name: string,
    step: () => Promise<T>,
    warn: (message: string) => void
): Promise<T> {
    try {
        return await step();
    } catch (error) {
        if (!String(error).includes(LOST)) throw error;
        warn(`::warning title=Lost promise in e2e startup::${name} ran again: ${LOST}`);
        return step();
    }
}
