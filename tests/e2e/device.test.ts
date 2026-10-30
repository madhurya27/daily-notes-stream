import { describe, it, expect } from "vitest";
import { deviceToDrive, drivesIPad, orientationToDrive } from "../../e2e-tests/ios/device";

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

describe("orientationToDrive", () => {
    it("is the orientation IOS_ORIENTATION names", () => {
        expect(orientationToDrive({ IOS_ORIENTATION: "PORTRAIT" })).toBe("PORTRAIT");
        expect(orientationToDrive({ IOS_ORIENTATION: "LANDSCAPE" })).toBe("LANDSCAPE");
    });

    it("is none without IOS_ORIENTATION, so the device stays as it is", () => {
        expect(orientationToDrive({})).toBeUndefined();
    });

    it("refuses any other orientation", () => {
        expect(() => orientationToDrive({ IOS_ORIENTATION: "portrait" })).toThrow(
            "IOS_ORIENTATION must be PORTRAIT or LANDSCAPE, not portrait"
        );
    });
});
