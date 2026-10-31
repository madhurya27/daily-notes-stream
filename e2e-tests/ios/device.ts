/** A device as `devicectl list devices` lists it, with the fields read here. */
export interface ListedDevice {
    connectionProperties: { transportType: string };
    deviceProperties: { name: string };
    hardwareProperties: { deviceType: string; reality: string; udid: string };
}

const TYPES = ["iPhone", "iPad"];

/**
 * The device on the cable of the type `IOS_DEVICE` names: an iPhone, unless it
 * names an iPad. `test:ipados` sets it, so both can stay plugged in (D-168).
 */
export function deviceToDrive(devices: ListedDevice[], env: NodeJS.ProcessEnv): ListedDevice {
    const type = typeToDrive(env);
    if (!TYPES.includes(type)) throw new Error(`IOS_DEVICE must be iPhone or iPad, not ${type}`);
    const found = devices.find(
        (d) =>
            d.connectionProperties.transportType === "wired" &&
            d.hardwareProperties.reality === "physical" &&
            d.hardwareProperties.deviceType === type
    );
    if (!found) throw new Error(`No ${type} on USB.`);
    return found;
}

/** Whether this run uses an iPad, for a test that is only true on a phone. */
export function drivesIPad(env: NodeJS.ProcessEnv): boolean {
    return typeToDrive(env) === "iPad";
}

function typeToDrive(env: NodeJS.ProcessEnv): string {
    return env.IOS_DEVICE ?? "iPhone";
}

/** What a test's report says it ran on. */
export function screenNote(env: NodeJS.ProcessEnv, { width, height }: { width: number; height: number }): string {
    return `${typeToDrive(env)} ${width > height ? "landscape" : "portrait"}, ${width}x${height}`;
}

export type Orientation = "PORTRAIT" | "LANDSCAPE";
const ORIENTATIONS: readonly string[] = ["PORTRAIT", "LANDSCAPE"] satisfies Orientation[];

/**
 * What a run tests, each turned one way, however the device was left: every
 * test in the orientation `IOS_ORIENTATION` names, or upright on an iPhone. An
 * iPad runs every test on its side, then those tagged `@portrait` (D-193).
 */
export function deviceProjects(env: NodeJS.ProcessEnv): DeviceProject[] {
    const wanted = env.IOS_ORIENTATION;
    if (wanted !== undefined && !ORIENTATIONS.includes(wanted))
        throw new Error(`IOS_ORIENTATION must be PORTRAIT or LANDSCAPE, not ${wanted}`);
    if (wanted !== undefined) return [everyTest(wanted as Orientation)];
    if (!drivesIPad(env)) return [everyTest("PORTRAIT")];
    return [everyTest("LANDSCAPE"), { ...everyTest("PORTRAIT"), grep: /@portrait/ }];
}

type DeviceProject = { name: string; use: { orientation: Orientation }; grep?: RegExp };

const everyTest = (orientation: Orientation): DeviceProject => ({
    name: orientation.toLowerCase(),
    use: { orientation },
});
