/**
 * The keyboard settings to leave on the phone after a run, as WebDriverAgent
 * settings. WebDriverAgent turns autocorrection and prediction off each time it
 * starts, on a real phone too, and never turns them back on (D-112).
 */
export function keyboardAfterRun(env: NodeJS.ProcessEnv): {
    keyboardAutocorrection: boolean;
    keyboardPrediction: boolean;
} {
    return {
        keyboardAutocorrection: isOn(env, "IOS_KEYBOARD_AUTOCORRECT"),
        keyboardPrediction: isOn(env, "IOS_KEYBOARD_PREDICTION"),
    };
}

function isOn(env: NodeJS.ProcessEnv, name: string): boolean {
    const value = env[name] ?? "on";
    if (value !== "on" && value !== "off") throw new Error(`${name} must be on or off, not ${value}`);
    return value === "on";
}
