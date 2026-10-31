import { expect } from "@playwright/test";
import { createHash } from "crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { demoVault } from "../../scripts/demo-vault.mjs";
import { DEMO as README_DEMO } from "../demo";
import { testVault } from "../../scripts/seed-test-vault.mjs";
import type { Phone } from "./phone";
import { PLUGIN_ID, vaultConfig } from "./vault-config";
import { recordingAsked } from "../recording-asked";

/**
 * The tests' own vault on the phone, stored on the phone, not in iCloud. It
 * holds the demo journal up to a fixed day, so it has the same notes on any
 * phone, on any day (ADR 0016).
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/**
 * A run for the README recording: the desktop recording's journal, with nothing
 * made for a test.
 */
const RECORDING = recordingAsked();
export const VAULT = process.env.IOS_VAULT ?? (RECORDING ? "Stream Demo" : "Stream E2E");
/**
 * How many days of journal: 21, unless IOS_SEED_DAYS sets another number, such
 * as 1825 for five years.
 */
const DEMO: Record<string, string> = demoVault({
    until: new Date(Date.UTC(2026, 8, 30)),
    days: Number(process.env.IOS_SEED_DAYS ?? 21),
});
/**
 * Things that used to stop iOS's scrolling, put in the newest notes so a flick
 * from the top starts on them: math (D-085), a Base, a wide table and a long
 * line of code (ADR 0008).
 */
export const STALLERS = [
    "## Stallers",
    "",
    "Effort: $\\dot{V}O_2 \\approx 48$, $CO_2$.",
    "",
    "| Route | Effort | Notes on the route, long enough to overrun a phone's width |",
    "| --- | --- | --- |",
    "| Old town circuit | $\\dot{V}O_2 \\approx 48$ | Cobbles after the bridge, then the long climb past the market |",
    "",
    "![[Reading.base]]",
    "",
    "![[Names.base]]",
    "",
    "![[Days.base]]",
    "",
    "```",
    "const pace = splits.map((split) => split.seconds / split.metres).reduce((sum, each) => sum + each, 0);",
    "```",
    "",
    "",
];
const NEWEST = Object.keys(DEMO)
    .filter((path) => /^Journal\/\d{4}-\d\d-\d\d\.md$/.test(path))
    .sort()
    .slice(-3);
/**
 * Two short notes in the middle of the stream, so from any place in them, the
 * next note's title is on screen below for a finger to tap. One ends in a Base,
 * for a place inside it, and the one below it has no Base. 2026-09-20, a
 * Sunday, has its own Base.
 */
export const SHORT_NOTE_WITH_BASE = "Journal/2026-09-22.md";
export const SHORT_NOTE = "Journal/2026-09-21.md";
/** The kanban in the short note with Bases, the note above `SHORT_NOTE`. */
export const SHORT_KANBAN = `.daily-note-block[data-source-path="${SHORT_NOTE_WITH_BASE}"] .daily-note-base:has(+ .daily-note-base)`;
/**
 * A note with every kind of fold arrow: on its properties, its headings, and a
 * list item holding a list.
 */
export const NESTED_LIST_NOTE = "Journal/2026-09-26.md";
/**
 * The test vault's note with one of each kind of embed (docs/TESTING.md), the
 * oldest note here, and the files it embeds.
 */
export const EMBEDS_NOTE = "Journal/2026-08-30.md";
/**
 * Kanban.base, `EMBEDS_NOTE`'s seventh Base: one column for each file type
 * (D-107).
 */
/** Middle.base, `EMBEDS_NOTE`'s fourth Base. */
export const MIDDLE = `.daily-note-block[data-source-path="${EMBEDS_NOTE}"] .daily-note-content > .daily-note-base:nth-child(4 of .daily-note-base)`;
export const KANBAN = `.daily-note-block[data-source-path="${EMBEDS_NOTE}"] .daily-note-content > .daily-note-base:nth-child(7 of .daily-note-base)`;
export const KANBAN_FILE = "Bases/Kanban.base";
const TEST: Record<string, string> = testVault({ days: 0 });
/**
 * Without a filter, the test Bases list every file: over five years, that is
 * thousands of rows and a note a million pixels tall. Limited to one month of
 * the journal.
 */
export const A_MONTH = [
    "filters:",
    "  or:",
    `    - '!file.inFolder("Journal")'`,
    `    - 'file.name >= "${EMBEDS_NOTE.slice("Journal/".length, -".md".length)}"'`,
    "",
].join("\n");
const EMBEDS = {
    [EMBEDS_NOTE]: TEST["Notes/2026-08-30.md"]!.replaceAll("```base\n", `\`\`\`base\n${A_MONTH}`),
    ...Object.fromEntries(
        Object.entries(TEST)
            .filter(([path]) => path.startsWith("Bases/"))
            .map(([path, base]) => [path, A_MONTH + base])
    ),
    "Attachments/Manual.pdf": TEST["Attachments/Manual.pdf"]!,
    "Reading list.md": TEST["Reading list.md"]!,
};
/**
 * A table of `columns` for the notes in Days/. Narrow, so a phone draws it as a
 * table, not cards (D-033).
 */
const daysTable = (columns: string[]) =>
    [
        "filters:",
        "  and:",
        '    - file.inFolder("Days")',
        "views:",
        "  - type: table",
        "    name: Days",
        "    order:",
        ...columns.map((column) => `      - ${column}`),
        "",
    ].join("\n");
/**
 * A link, a date and a link to a day in a Base. A touch on any of them used to
 * stop the stream from scrolling (D-167).
 */
const DAYS = {
    "Names.base": daysTable(["file.name"]),
    "Days.base": daysTable(["when", "day"]),
    ...Object.fromEntries(
        [
            ["One", "2026-09-20"],
            ["Two", "2026-09-21"],
            ["Three", "2026-09-22"],
        ].map(([name, day]) => [`Days/${name}.md`, `---\nwhen: ${day}\nday: "[[${day}]]"\n---\n`])
    ),
};
/**
 * Days with no note in the journal, so a test can write its own note on one and
 * delete it.
 */
export const FREE_DAYS = ["Journal/2026-09-05.md", "Journal/2026-09-06.md"] as const;
/** How many plain days the lane has on each side of its slot. */
const LANE_SIDE = 10;
/** The lane's middle day, where every glide test starts. */
const SLOT_DAY = Date.UTC(2026, 6, 30);
const dayPath = (offset: number) => `Journal/${new Date(SLOT_DAY + offset * 86_400_000).toISOString().slice(0, 10)}.md`;
/**
 * Plain days below the oldest note, where every glide test flicks: the same
 * notes around each glide, so only what a test writes into `LANE_SLOT`
 * differs. Each side is longer than a full glide and the notes rendered ahead
 * of it, so a glide never reaches a note outside it: `glidesInLane` and
 * `glidesOnto` fail if one does.
 */
export const LANE_SLOT = dayPath(0);
/** The lane day `days` from the slot, in the direction a flick scrolls. */
export const laneDayAhead = (direction: "up" | "down", days: number) => dayPath(direction === "up" ? -days : days);
/**
 * A lane day's text: plain paragraphs, 1,440 px tall on an iPad at default
 * settings.
 */
export const LANE_TEXT = Array.from(
    { length: 8 },
    (_, i) =>
        `Paragraph ${i + 1}. ` +
        "Plain words in a sentence that runs on to fill a few lines of the note, with nothing in it to render but text. ".repeat(
            5
        )
)
    .map((paragraph) => paragraph.trim())
    .join("\n\n");
/** How many days the lane has, its slot included. */
const LANE_DAYS = 2 * LANE_SIDE + 1;
export const LANE_NOTES = Array.from({ length: LANE_DAYS }, (_, i) => dayPath(i - LANE_SIDE));
const LANE = Object.fromEntries(LANE_NOTES.map((path) => [path, `${LANE_TEXT}\n`]));
const TEST_NOTES = {
    ...Object.fromEntries(Object.entries(DEMO).filter(([path]) => !(FREE_DAYS as readonly string[]).includes(path))),
    ...EMBEDS,
    ...DAYS,
    ...Object.fromEntries(
        NEWEST.map((path) => [path, DEMO[path]!.replace(/^(---\n[\s\S]*?\n---\n\n)/, `$1${STALLERS.join("\n")}`)])
    ),
    // First, so its arrow is on screen together with the properties' arrow.
    [NESTED_LIST_NOTE]: DEMO[NESTED_LIST_NOTE]!.replace(
        /^(---\n[\s\S]*?\n---\n\n)/,
        "$1## Packing\n\n- Bag\n    - Charger\n    - Passport\n\n"
    ),
    // After the journal, which with IOS_SEED_DAYS has days of its own here.
    ...LANE,
    [SHORT_NOTE]: "A short day, one paragraph long.\n",
    [SHORT_NOTE_WITH_BASE]: "A short day, a board, then the reading list.\n\n![[Kanban.base]]\n\n![[Reading.base]]\n",
};

const NOTES = RECORDING ? README_DEMO : TEST_NOTES;

/**
 * Everything the vault holds, including configuration and the build, by path.
 */
function contents(configDir: string): Record<string, string> {
    const config = vaultConfig({ recording: RECORDING });
    const build = ["main.js", "manifest.json", "styles.css"].map((name) => [
        `${configDir}/plugins/${PLUGIN_ID}/${name}`,
        readFileSync(join(REPO, name), "utf8"),
    ]);
    return {
        ...NOTES,
        ...Object.fromEntries(
            Object.entries(config).map(([name, value]) => [`${configDir}/${name}`, JSON.stringify(value)])
        ),
        ...Object.fromEntries(build),
    };
}

/**
 * Opens the vault by its URL, or creates it through the vault chooser. Never
 * through a vault's page in the chooser, because that page has Delete vault.
 */
async function open(phone: Phone): Promise<void> {
    const name = () => openVault(phone);
    if ((await name()) === VAULT) return;
    await phone.openUrl(`obsidian://open?vault=${encodeURIComponent(VAULT)}`);
    try {
        await expect.poll(name, { timeout: 10_000 }).toBe(VAULT);
        return;
    } catch {
        // No such vault yet.
    }
    // Each step draws the chooser again, so each waits for what the last one
    // drew.
    const shows = (selector: string) => () =>
        phone.run((sel: string) => !!document.querySelector(sel), selector).catch(() => false);
    // Already shown, with no vault open, if an earlier run stopped there.
    await phone.run(() => document.querySelector(".mobile-vault-chooser") || window.app.openVaultChooser());
    await expect.poll(shows(".mobile-vault-chooser .lucide-plus-circle")).toBe(true);
    // Found by its icon, not its label, because Obsidian may be in another
    // language.
    await phone.run(() =>
        document
            .querySelector(".mobile-vault-chooser .lucide-plus-circle")!
            .closest<HTMLElement>(".mobile-vault-chooser-action")!
            .click()
    );
    await expect.poll(shows('.mobile-vault-chooser input[type="text"]')).toBe(true);
    await phone.run((vault: string) => {
        const input = document.querySelector<HTMLInputElement>('.mobile-vault-chooser input[type="text"]')!;
        input.value = vault;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // On the phone, because an iCloud vault's changes sync to every device
        // on the account.
        const iCloud = document.querySelector<HTMLInputElement>('.mobile-vault-chooser input[type="checkbox"]');
        if (iCloud?.checked) iCloud.click();
        document.querySelector<HTMLButtonElement>(".mobile-vault-chooser button.mod-cta")!.click();
    }, VAULT);
    await expect.poll(name, { timeout: 30_000 }).toBe(VAULT);
}

/**
 * Makes the vault hold exactly `contents`, apart from its config folder, and
 * reloads Obsidian. Skipped when the vault's fingerprint shows the same
 * contents were already written.
 */
async function seed(phone: Phone): Promise<void> {
    const configDir = await phone.run(() => window.app.vault.configDir as string);
    const files = contents(configDir);
    const fingerprint = createHash("sha1").update(JSON.stringify(files)).digest("hex");
    const stamp = `${configDir}/stream-e2e-seed`;
    const [notes, config] = partition(files, (path) => !path.startsWith(`${configDir}/`));
    const loaded = (id: string) => !!window.app?.plugins?.plugins?.[id];
    // A run that stopped early leaves behind the notes its tests made, which
    // the fingerprint cannot see.
    const strays = (paths: string[]) =>
        (window.app.vault.getFiles() as { path: string }[]).some(({ path }) => !paths.includes(path));
    if (
        (await phone.runAsync(
            async (path: string) =>
                (await window.app.vault.adapter.exists(path)) && window.app.vault.adapter.read(path),
            stamp
        )) === fingerprint &&
        (await phone.run(loaded, PLUGIN_ID)) &&
        !(await phone.run(strays, Object.keys(notes)))
    )
        return;
    const ready = () => phone.run(() => !!window.app?.vault?.adapter).catch(() => false);
    // Turn off restricted mode before the plugin list names a plugin, or
    // Obsidian asks whether to trust the vault. Turning it off may reload the
    // app.
    await phone
        .runAsync(async () => {
            if (!window.app.plugins.isEnabled()) await window.app.plugins.setEnable(true);
        })
        .catch(() => undefined);
    await expect.poll(ready).toBe(true);
    await phone.runAsync(async (files: Record<string, string>) => {
        const { adapter } = window.app.vault;
        // The vault's own index, which leaves out the config folder, because
        // the mobile adapter has no listRecursive.
        await Promise.all(
            (window.app.vault.getFiles() as { path: string }[])
                .filter(({ path }) => !(path in files))
                .map(({ path }) => adapter.remove(path))
        );
        const folders = new Set(Object.keys(files).map((path) => path.split("/").slice(0, -1).join("/")));
        for (const folder of [...folders].filter(Boolean).sort())
            if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
        await Promise.all(Object.entries(files).map(([path, text]) => adapter.write(path, text)));
    }, notes);
    // The fingerprint is written last, because Obsidian may reload when its
    // config changes, which ends the script.
    await phone
        .runAsync(
            async (files: Record<string, string>, plugin: string) => {
                const { adapter, configDir } = window.app.vault;
                await adapter.mkdir(`${configDir}/plugins/${plugin}`).catch(() => undefined);
                for (const [path, text] of Object.entries(files)) await adapter.write(path, text);
            },
            { ...config, [stamp]: fingerprint },
            PLUGIN_ID
        )
        .catch(() => undefined);
    await expect.poll(ready).toBe(true);
    // The old page still answers until the reload happens. Marked, it cannot be
    // mistaken for the new one.
    await phone.run(() => {
        (window as unknown as { staleVault: boolean }).staleVault = true;
        window.app.commands.executeCommandById("app:reload");
    });
    // Its layout must be ready too. Until then, the stream's command opens
    // nothing.
    const reloaded = (id: string) =>
        !(window as unknown as { staleVault?: boolean }).staleVault &&
        !!window.app?.plugins?.plugins?.[id] &&
        !!window.app.workspace.layoutReady;
    await expect.poll(() => phone.run(reloaded, PLUGIN_ID).catch(() => false), { timeout: 30_000 }).toBe(true);
}

function partition(
    files: Record<string, string>,
    test: (path: string) => boolean
): [Record<string, string>, Record<string, string>] {
    const entries = Object.entries(files);
    return [
        Object.fromEntries(entries.filter(([path]) => test(path))),
        Object.fromEntries(entries.filter(([path]) => !test(path))),
    ];
}

/** Opens the tests' vault, filled, with this build loaded. */
export async function useVault(phone: Phone): Promise<void> {
    await rememberTestersVault(phone);
    await open(phone);
    await seed(phone);
    await laidOut(phone);
    await indexed(phone);
}

/**
 * Waits for Obsidian to restore its tabs, which only happens after `seed`
 * writes. A stream opened before that has no tab to open in, and Obsidian
 * throws an error.
 */
async function laidOut(phone: Phone): Promise<void> {
    await expect
        .poll(() => phone.run(() => !!window.app?.workspace?.layoutReady).catch(() => false), { timeout: 60_000 })
        .toBe(true);
}

/**
 * Waits until Obsidian has indexed the vault. Until every note has its cache
 * and links, each note that is indexed draws the stream and its mentions again
 * during the tests. This takes minutes for a new five-year vault.
 */
async function indexed(phone: Phone): Promise<void> {
    const done = () => {
        const { vault, metadataCache } = window.app;
        const notes = vault.getMarkdownFiles() as { path: string }[];
        return notes.every(
            (note) => metadataCache.getFileCache(note) !== null && note.path in metadataCache.resolvedLinks
        );
    };
    await expect.poll(() => phone.run(done).catch(() => false), { timeout: 600_000, intervals: [2_000] }).toBe(true);
}

/**
 * The tester's vault, saved on disk until it is opened again, because a worker
 * restarted after a failure finds the tests' vault open.
 */
const TESTERS_VAULT = join(REPO, ".dev/ios-testers-vault");

function openVault(phone: Phone): Promise<string | undefined> {
    return phone.run(() => window.app?.vault?.getName() as string | undefined).catch(() => undefined);
}

async function rememberTestersVault(phone: Phone): Promise<void> {
    const name = await openVault(phone);
    if (name && name !== VAULT) writeFileSync(TESTERS_VAULT, name);
}

/**
 * Opens the vault the tester had open, so Obsidian also starts in it next time.
 */
export async function returnToTestersVault(phone: Phone): Promise<void> {
    if (!existsSync(TESTERS_VAULT)) return;
    const name = readFileSync(TESTERS_VAULT, "utf8");
    await phone.openUrl(`obsidian://open?vault=${encodeURIComponent(name)}`);
    await expect.poll(() => openVault(phone), { timeout: 30_000 }).toBe(name);
    rmSync(TESTERS_VAULT);
}
