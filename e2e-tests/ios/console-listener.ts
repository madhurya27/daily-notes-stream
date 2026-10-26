/**
 * Makes the XCUITest driver use only one console listener at a time (D-144).
 */

const START = /^( *)this\.remote\.startConsole\(eventListener\);$/m;
const STOP = "this.remote.stopConsole();";

/** The driver's `context.js`, changed to use one console listener at a time. */
export function oneConsoleListener(source: string): string {
    const start = START.exec(source);
    if (!start)
        throw new Error(
            "The XCUITest driver no longer starts its console listener as e2e-tests/ios/console-listener.ts expects."
        );
    if (source.includes(STOP)) return source;
    const indent = start[1]!;
    return source.replace(START, `${indent}${STOP}\n${start[0]}`);
}
