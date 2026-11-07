import { test, expect } from "./phone";
import { SHORT_NOTE } from "./vault";

/** Marks the file menu's Show in stream item, which CSS cannot find by text. */
const SHOW_IN_STREAM = '[data-test="show-in-stream"]';

test.afterEach(async ({ phone }) => {
    await phone.run(() => {
        window.app.workspace.leftSplit.collapse();
        window.app.workspace.detachLeavesOfType("markdown");
    });
});

// iOS opens the file menu on a long press, as a sheet (D-218).
test("a long press on a daily note in the file explorer, then Show in stream, opens the stream at it", async ({
    phone,
}) => {
    await phone.run(() => window.app.workspace.detachLeavesOfType("daily-notes-stream-view"));
    await phone.runAsync(async (path: string) => {
        await window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath(path)!);
        window.app.commands.executeCommandById("file-explorer:reveal-active-file");
    }, SHORT_NOTE);
    const entry = `.nav-file-title[data-path="${SHORT_NOTE}"]`;
    await expect.poll(() => phone.has(entry), "the file explorer never showed the note").toBe(true);
    // Revealed, the note sits at the list's bottom edge, under the explorer's
    // floating buttons, which would take the press.
    await phone.run((sel: string) => document.querySelector(sel)!.scrollIntoView({ block: "center" }), entry);

    await phone.longPress(entry);
    await expect
        .poll(() =>
            phone.run((mark: string) => {
                const item = [...document.querySelectorAll(".menu-item")].find(
                    (el) => el.textContent?.trim() === "Show in stream"
                );
                item?.setAttribute("data-test", "show-in-stream");
                return !!document.querySelector(mark);
            }, SHOW_IN_STREAM)
        )
        .toBe(true);
    await phone.tap(SHOW_IN_STREAM);

    await expect
        .poll(() =>
            phone.run((path: string) => {
                const block = document.querySelector(`.daily-note-block[data-source-path="${path}"]`);
                if (!block) return Infinity;
                const pane = block.closest(".daily-notes-stream-container")!.parentElement!;
                return Math.abs(block.getBoundingClientRect().top - pane.getBoundingClientRect().top);
            }, SHORT_NOTE)
        )
        .toBeLessThan(40);
});
