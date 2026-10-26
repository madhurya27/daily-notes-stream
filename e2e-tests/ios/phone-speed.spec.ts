import { drivesIPad } from "./device";
import { test, expect } from "./phone";
import { TARGET_PHONE_WORKLOAD_MS, WORKLOAD_NOTE, timeWorkload } from "../phone-speed";

// The specs time against a phone slower than any iPhone that runs iOS 26
// (D-131), so any such iPhone does the work faster. An iPhone 16 Pro takes
// 7.6–9.0 ms.
test("this iPhone is faster than the phone the specs time against", async ({ phone }) => {
    test.skip(drivesIPad(process.env), "the specs time against iPhones");
    await phone.openStream();
    const ms = await phone.runAsync(timeWorkload, WORKLOAD_NOTE);
    console.log(`workload on this phone: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(TARGET_PHONE_WORKLOAD_MS);
});
