import { describe, it, expect } from "vitest";
import { layoutFrom } from "../../scripts/window-layout.mjs";
import { boundsFor, emulateDevice } from "../../scripts/window-layout.mjs";

describe("layoutFrom", () => {
    it("opens a phone in portrait by default", () => {
        expect(layoutFrom([])).toEqual({ device: "phone", mobile: true, size: { width: 420, height: 900 } });
    });

    it("gives the iPad a tablet window, still emulating mobile", () => {
        expect(layoutFrom(["--ipad"])).toEqual({ device: "ipad", mobile: true, size: { width: 820, height: 1180 } });
    });

    it("gives the desktop a window wide enough for the layout it turns on", () => {
        expect(layoutFrom(["--desktop"])).toEqual({
            device: "desktop",
            mobile: false,
            size: { width: 1280, height: 860 },
        });
    });

    it("turns a size on its side for --landscape", () => {
        expect(layoutFrom(["--landscape"]).size).toEqual({ width: 900, height: 420 });
        expect(layoutFrom(["--ipad", "--landscape"]).size).toEqual({ width: 1180, height: 820 });
    });

    it("asks for no size at all under --keep-size", () => {
        expect(layoutFrom(["--keep-size"])).toEqual({ device: "phone", mobile: true, size: null });
        expect(layoutFrom(["--desktop", "--keep-size"]).size).toBeNull();
    });
});

describe("emulateDevice", () => {
    /**
     * A page whose `evaluate` runs the callback in jsdom's window, and whose
     * `waitForFunction` gives up instead of checking again and again: in this
     * window, a condition that is not already true never becomes true.
     */
    const fakePage = (isMobile: boolean, { reloads = true } = {}) => {
        const emulated: boolean[] = [];
        (window as unknown as { app: unknown }).app = {
            isMobile,
            // The real one reloads, which removes the old document's globals.
            emulateMobile: (on: boolean) => {
                emulated.push(on);
                if (reloads)
                    for (const key of Object.keys(window))
                        if (key.startsWith("__")) delete (window as unknown as Record<string, unknown>)[key];
            },
            workspace: { layoutReady: true },
        };
        return {
            emulated,
            evaluate: async (fn: (arg: never) => unknown, arg: never) => fn(arg),
            waitForFunction: async (fn: (arg: never) => unknown, arg: never) => {
                if (!fn(arg)) throw new Error("waitForFunction timed out");
            },
        };
    };

    it("turns emulation on for a phone", async () => {
        const page = fakePage(false);
        await expect(emulateDevice(page, true)).resolves.toBe(true);
        expect(page.emulated).toEqual([true]);
    });

    it("waits for the document the reload brings back, not the one that answered first", async () => {
        const page = fakePage(false, { reloads: false });
        await expect(emulateDevice(page, true)).rejects.toThrow("timed out");
    });

    it("does nothing when the emulation already matches", async () => {
        const page = fakePage(true);
        await expect(emulateDevice(page, true)).resolves.toBe(false);
        expect(page.emulated).toEqual([]);
    });
});

describe("boundsFor", () => {
    it("opens in the display's top-left corner, a margin in", () => {
        expect(boundsFor({ size: { width: 420, height: 900 } })).toMatchObject({
            x: 40,
            y: 40,
            width: 420,
            height: 900,
            isMaximized: false,
        });
    });

    it("leaves the saved size alone when no size is asked for", () => {
        const saved = { width: 700, height: 500, zoom: 2 };
        expect(boundsFor({ saved, size: null })).toMatchObject({ width: 700, height: 500, zoom: 2 });
    });

    it("lets an explicit position win over the corner", () => {
        expect(boundsFor({ size: null, position: { x: 900, y: 60 } })).toMatchObject({ x: 900, y: 60 });
    });

    it("never restores a maximized window, whatever the saved bounds say", () => {
        expect(boundsFor({ saved: { isMaximized: true }, size: null }).isMaximized).toBe(false);
    });
});
