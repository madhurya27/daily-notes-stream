import { remote } from "webdriverio";

export const APPIUM_PORT = 4723;
export const OBSIDIAN = "md.obsidian";
export const SAFARI = "com.apple.mobilesafari";

/**
 * A WebDriverAgent session on the phone `global-setup.ts` found, with `app` in
 * front.
 */
export async function connect(app = OBSIDIAN): Promise<WebdriverIO.Browser> {
    const driver = await remote({
        hostname: "127.0.0.1",
        port: APPIUM_PORT,
        logLevel: "warn",
        // A command that fails on the phone fails the same way if tried again.
        connectionRetryCount: 0,
        capabilities: {
            platformName: "iOS",
            "appium:automationName": "XCUITest",
            "appium:udid": process.env.IOS_UDID,
            "appium:bundleId": app,
            "appium:noReset": true,
            "appium:usePrebuiltWDA": true,
            "appium:derivedDataPath": process.env.IOS_WDA_DATA,
            "appium:updatedWDABundleId": process.env.IOS_WDA_BUNDLE,
            "appium:xcodeOrgId": process.env.IOS_TEAM_ID,
            "appium:xcodeSigningId": "Apple Development",
            "appium:newCommandTimeout": 300,
            "appium:showSafariConsoleLog": true,
        },
    });
    await driver.setTimeout({ script: 30_000 });
    return driver;
}
