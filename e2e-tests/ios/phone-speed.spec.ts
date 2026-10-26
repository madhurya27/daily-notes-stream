import { drivesIPad } from "./device";
import { test, expect } from "./phone";
import { TARGET_PHONE_WORKLOAD_MS, WORKLOAD_NOTE, timeWorkload } from "../phone-speed";

// Measured on an iPhone 16 Pro, which has twice an iPhone 11's single-core
// speed. The speed the tests slow a laptop down to stays a little slower than
// an iPhone 11.
test("the phone the specs time against is about 2.3 times slower than this one", async ({ phone }) => {
    test.skip(drivesIPad(process.env), "it measures the iPhone the specs time against");
    await phone.openStream();
    const ms = await phone.runAsync(timeWorkload, WORKLOAD_NOTE);
    console.log(`workload on this phone: ${ms.toFixed(2)} ms`);
    expect(TARGET_PHONE_WORKLOAD_MS / ms).toBeGreaterThan(2);
    expect(TARGET_PHONE_WORKLOAD_MS / ms).toBeLessThan(2.7);
});
