import { describe, it, expect } from "vitest";
import { deviceToDrive, drivesIPad, deviceProjects, screenNote } from "../../e2e-tests/ios/device";

function device(name: string, deviceType: string, transportType = "wired", reality = "physical") {
    return {
        connectionProperties: { transportType },
        deviceProperties: { name },
        hardwareProperties: { deviceType, reality, udid: `${name}-udid` },
    };
}

// Both can stay plugged in: test:ios uses the iPhone, and test:ipados the iPad
// (D-168).
describe("deviceToDrive", () => {
    const phone = device("GLaDOS", "iPhone");
    const pad = device("iPad", "iPad");

    it("drives the iPhone by default", () => {
        expect(deviceToDrive([pad, phone], {})).toBe(phone);
    });

    it("drives the iPad when IOS_DEVICE asks for one", () => {
        expect(deviceToDrive([phone, pad], { IOS_DEVICE: "iPad" })).toBe(pad);
    });

    it("skips one on Wi-Fi, and a simulator", () => {
        const wireless = device("Far", "iPhone", "localNetwork");
        const simulator = device("Sim", "iPhone", "wired", "virtual");
        expect(deviceToDrive([wireless, simulator, phone], {})).toBe(phone);
    });

    it("names the type it found none of", () => {
        expect(() => deviceToDrive([phone], { IOS_DEVICE: "iPad" })).toThrow("No iPad on USB.");
    });

    it("rejects anything but iPhone or iPad, before the run", () => {
        expect(() => deviceToDrive([phone], { IOS_DEVICE: "Watch" })).toThrow(
            "IOS_DEVICE must be iPhone or iPad, not Watch"
        );
    });
});

describe("drivesIPad", () => {
    it("is true only when IOS_DEVICE names an iPad", () => {
        expect(drivesIPad({ IOS_DEVICE: "iPad" })).toBe(true);
        expect(drivesIPad({ IOS_DEVICE: "iPhone" })).toBe(false);
        expect(drivesIPad({})).toBe(false);
    });
});

describe("deviceProjects", () => {
    const every = (orientation: string) => ({ name: orientation.toLowerCase(), use: { orientation } });

    it("runs every test upright on an iPhone, however the device was left", () => {
        expect(deviceProjects({})).toEqual([every("PORTRAIT")]);
    });

    // Landscape is how an iPad is mostly used. Portrait is laid out more like
    // an iPhone, and running every test twice would double a run's time.
    it("runs every test on an iPad on its side, then the tagged tests upright", () => {
        expect(deviceProjects({ IOS_DEVICE: "iPad" })).toEqual([
            every("LANDSCAPE"),
            { ...every("PORTRAIT"), grep: /@portrait/ },
        ]);
    });

    it("runs every test in only the one IOS_ORIENTATION names", () => {
        expect(deviceProjects({ IOS_DEVICE: "iPad", IOS_ORIENTATION: "PORTRAIT" })).toEqual([every("PORTRAIT")]);
        expect(deviceProjects({ IOS_ORIENTATION: "LANDSCAPE" })).toEqual([every("LANDSCAPE")]);
    });

    it("refuses any other orientation", () => {
        expect(() => deviceProjects({ IOS_ORIENTATION: "portrait" })).toThrow(
            "IOS_ORIENTATION must be PORTRAIT or LANDSCAPE, not portrait"
        );
    });
});

// A report must say what it ran on.
describe("screenNote", () => {
    it("names an iPad on its side", () => {
        expect(screenNote({ IOS_DEVICE: "iPad" }, { width: 1180, height: 820 })).toBe("iPad landscape, 1180x820");
    });

    it("names an upright iPhone", () => {
        expect(screenNote({}, { width: 402, height: 874 })).toBe("iPhone portrait, 402x874");
    });
});
