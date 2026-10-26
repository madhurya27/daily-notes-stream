import { execFileSync, spawn, spawnSync, type ChildProcess } from "child_process";
import { X509Certificate } from "crypto";
import { mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { oneConsoleListener } from "./console-listener";
import { deviceToDrive } from "./device";
import { keyboardAfterRun } from "./keyboard";
import { loadLocalEnv } from "./local-env";
import { recordingAsked } from "../recording-asked";
import { writeWebp } from "../../scripts/recording.mjs";
import { FRAMES, startScreenCapture, type Scene } from "./screen-capture";
import { APPIUM_PORT } from "./session";

/**
 * Gets an iPhone or iPad connected by USB ready for `phone.ts`: the XCUITest
 * driver, a WebDriverAgent signed by this Mac's Apple Development certificate,
 * and an Appium server (ADR 0016).
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEV = join(REPO, ".dev");
const APPIUM = join(REPO, "node_modules/.bin/appium");
const XCUITEST = "xcuitest@12.13.3";

/**
 * Xcode itself, because the command-line tools alone have no `devicectl` or iOS
 * SDK.
 */
function developerDir(): string {
    const selected = execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim();
    return selected.includes("CommandLineTools") ? "/Applications/Xcode.app/Contents/Developer" : selected;
}

/**
 * The team in the Apple Development certificate's subject, written as `OU=`.
 */
function teamId(): string {
    const pem = execFileSync("security", ["find-certificate", "-c", "Apple Development", "-p"], { encoding: "utf8" });
    const team = /^OU=(\w+)$/m.exec(new X509Certificate(pem).subject)?.[1];
    if (!team) throw new Error("No Apple Development certificate: Xcode → Settings → Accounts → Manage Certificates.");
    return team;
}

function devicectl(env: NodeJS.ProcessEnv, ...args: string[]): any {
    const out = join(DEV, "devicectl.json");
    execFileSync("xcrun", ["devicectl", ...args, "--quiet", "--json-output", out], { env });
    return JSON.parse(readFileSync(out, "utf8")).result;
}

/**
 * The iPhone or iPad on the cable, which must be unlocked, because with a
 * locked one WebDriverAgent waits until the test's timeout.
 */
function connectedPhone(env: NodeJS.ProcessEnv): string {
    const phone = deviceToDrive(devicectl(env, "list", "devices").devices, env);
    const { udid } = phone.hardwareProperties;
    if (devicectl(env, "device", "info", "lockState", "--device", udid).passcodeRequired)
        throw new Error(`Unlock ${phone.deviceProperties.name}.`);
    return udid;
}

function installDriver(env: NodeJS.ProcessEnv): void {
    const installed = execFileSync(APPIUM, ["driver", "list", "--installed", "--json"], { env, encoding: "utf8" });
    if (!("xcuitest" in JSON.parse(installed)))
        execFileSync(APPIUM, ["driver", "install", XCUITEST], { env, stdio: "inherit" });
    const context = join(env.APPIUM_HOME!, "node_modules/appium-xcuitest-driver/build/lib/commands/context.js");
    writeFileSync(context, oneConsoleListener(readFileSync(context, "utf8")));
}

/**
 * Only builds what changed after the first run. Signs again when the free
 * profile's week is over.
 */
function buildWebDriverAgent(env: NodeJS.ProcessEnv): void {
    const project = join(env.APPIUM_HOME!, "node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent");
    execFileSync(
        "xcodebuild",
        [
            "build-for-testing",
            ...["-project", join(project, "WebDriverAgent.xcodeproj"), "-scheme", "WebDriverAgentRunner"],
            ...["-destination", "generic/platform=iOS", "-derivedDataPath", env.IOS_WDA_DATA!],
            "-allowProvisioningUpdates",
            `DEVELOPMENT_TEAM=${env.IOS_TEAM_ID}`,
            `PRODUCT_BUNDLE_IDENTIFIER=${env.IOS_WDA_BUNDLE}`,
        ],
        { env, stdio: ["ignore", openSync(join(DEV, "wda-build.log"), "w"), "inherit"] }
    );
}

async function waitForAppium(): Promise<void> {
    for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
        try {
            if ((await fetch(`http://127.0.0.1:${APPIUM_PORT}/status`)).ok) return;
        } catch {
            // Not listening yet.
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Appium did not start: see ${join(DEV, "appium.log")}`);
}

/**
 * Encodes the frames inside the scene the recording marked, if it marked one.
 * The Focus banner iOS shows when a recording starts and stops is outside the
 * scene.
 */
/**
 * How much later a touch shows in the frames than the tests log it. A gesture
 * is logged when Appium answers, after the gesture ends. Measured: a key's
 * bubble shows 120–150 ms before, and a stroke's scroll 160 ms before.
 */
const TOUCH_SHIFT_MS = -150;

function encodeScene(): void {
    let scene: Scene;
    try {
        scene = JSON.parse(readFileSync(join(FRAMES, "scene.json"), "utf8")) as Scene;
    } catch {
        return;
    }
    const touches = join(FRAMES, "touches.json");
    writeFileSync(touches, JSON.stringify(scene.touches));
    execFileSync(
        "swift",
        [
            "-O",
            join(REPO, "scripts/draw-touches.swift"),
            FRAMES,
            touches,
            String(scene.screenWidth),
            String(TOUCH_SHIFT_MS),
        ],
        { stdio: "inherit" }
    );
    const frames = readdirSync(FRAMES)
        .filter((name) => name.endsWith(".png"))
        .map((name) => ({ timestamp: Number(name.slice(0, -4)) / 1000, path: join(FRAMES, name) }))
        .filter(({ timestamp }) => timestamp >= scene.start && timestamp <= scene.end)
        .sort((a, b) => a.timestamp - b.timestamp);
    // Lossy, because scrolling changes the whole screen each frame, and
    // lossless makes the file twice the size. Thirty frames a second, because a
    // key's bubble shows for about 60 ms, and scrolling looks jerky at ten.
    writeWebp(frames, scene.output, { quality: 80, minInterval: 1 / 30 });
}

/**
 * Starts Appium for the phone on the cable. Returns a function that stops it.
 */
export default async function startAppium(): Promise<() => Promise<void>> {
    mkdirSync(DEV, { recursive: true });
    loadLocalEnv(join(REPO, "e2e-tests/ios/.env"));
    // A typo fails here, not after the run.
    keyboardAfterRun(process.env);
    const team = teamId();
    // Set here, so the workers get them too.
    Object.assign(process.env, {
        APPIUM_HOME: join(DEV, "appium"),
        DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? developerDir(),
        IOS_TEAM_ID: team,
        IOS_WDA_BUNDLE: `dev.team${team.toLowerCase()}.WebDriverAgentRunner`,
        IOS_WDA_DATA: join(DEV, "wda"),
    });
    process.env.IOS_UDID = connectedPhone(process.env);
    // First, before WebDriverAgent connects, because starting a recording drops
    // its connection.
    let stopCapture = async () => {};
    if (recordingAsked()) {
        rmSync(FRAMES, { recursive: true, force: true });
        stopCapture = await startScreenCapture(FRAMES, 600);
    }
    installDriver(process.env);
    buildWebDriverAgent(process.env);

    const appium = spawn(
        APPIUM,
        ["--port", String(APPIUM_PORT), "--log", join(DEV, "appium.log"), "--log-level", "info:debug"],
        { env: process.env, stdio: "ignore" }
    );
    try {
        await waitForAppium();
    } catch (e) {
        stopAppium(appium);
        await stopCapture();
        throw e;
    }
    return async () => {
        stopAppium(appium);
        await stopCapture();
        // A recording's scene.json stays with the frames. Encoding it again on
        // a normal run replaced the README's recording.
        if (recordingAsked()) encodeScene();
    };
}

/**
 * Stops Appium, and the WebDriverAgent it started on the phone. Appium runs its
 * xcodebuild in a separate process group, which keeps running after Appium
 * stops.
 */
function stopAppium(appium: ChildProcess): void {
    appium.kill();
    spawnSync("pkill", ["-f", `xcodebuild test-without-building .* -derivedDataPath ${process.env.IOS_WDA_DATA} `]);
}
