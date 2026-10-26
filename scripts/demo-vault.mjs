/**
 * Writes `.dev/demo-vault/`: a journal that reads like a real person's, for
 * trying the plugin and for screenshots and screen recordings. The test vault
 * (`seed --test`) is for the checklist: its notes are made around edge cases,
 * and they look artificial in pictures.
 *
 *   pnpm run seed [vault] [--days N] [--until YYYY-MM-DD]
 *
 * Each note comes from a random generator started from its own date, and its
 * lines are dealt from decks chosen by its day or week. So a date gives the
 * same note on every run, and a recording can be made again. Like
 * `seed --test`, it deletes things: notes it no longer has are deleted, and
 * changed ones are written again. `.obsidian` is only written when it is
 * missing.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { isMain } from "./reload-plugin.mjs";
import { DEMO_VAULT, installBuild, PLUGIN_ID } from "./vaults.mjs";

const JOURNAL = "Journal";
/**
 * The daily notes template setting: a path without `.md`, as Obsidian saves it.
 */
export const DAILY_TEMPLATE = "Templates/Daily";
const TEMPLATE = ["---", "tags:", "  - daily", "mood:", "---", "", "## Morning", "", "## Work", "", "- ", ""];
/** About one day in twelve is made from the template and never written in. */
const UNWRITTEN_ODDS = 1 / 12;
const DAY_MS = 86_400_000;

/**
 * mulberry32: always the same numbers for the same seed, and different numbers
 * for different seeds.
 */
const seeded = (seed) => {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const picker = (random) => ({
    one: (items) => items[Math.floor(random() * items.length)],
    some: (items, count) => [...items].sort(() => random() - 0.5).slice(0, count),
    chance: (odds) => random() < odds,
    between: (low, high) => low + Math.floor(random() * (high - low + 1)),
});

/**
 * How many days a line cannot come back after a reshuffle. Within one deck, it
 * never comes back.
 */
const GAP = 3;

const hash = (text) => [...text].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) | 0, 0);
const shuffled = (pool, seed) => picker(seeded(seed)).some(pool, pool.length);

/**
 * The `count` lines of `pool` for `slot` (a day or a week), dealt from a deck
 * that is shuffled again each time it runs out, so no line comes back until the
 * deck is used up. In a deck's first GAP slots, any line that the previous deck
 * dealt in its last GAP slots is swapped out, only with lines between the two.
 * This means every deck can be worked out from its own seed, so a date gets the
 * same lines on every run.
 */
const deal = (pool, slot, count) => {
    const slots = Math.floor(pool.length / count);
    const cycle = Math.floor(slot / slots);
    const seed = hash(JSON.stringify(pool));
    const deck = shuffled(pool, seed + cycle);
    const end = slots * count;
    const gap = Math.min(GAP, Math.floor(slots / 3)) * count;
    const previous = new Set(shuffled(pool, seed + cycle - 1).slice(end - gap, end));
    const spare = deck
        .map((_, index) => index)
        .filter((index) => ((index >= gap && index < end - gap) || index >= end) && !previous.has(deck[index]));
    for (let index = 0; index < gap; index++) {
        if (!previous.has(deck[index])) continue;
        const swap = spare.shift();
        [deck[index], deck[swap]] = [deck[swap], deck[index]];
    }
    const start = (slot - cycle * slots) * count;
    return deck.slice(start, start + count);
};

const BOOKS = {
    "The Dispossessed": { author: "Ursula K. Le Guin", status: "reading", rating: 5 },
    Piranesi: { author: "Susanna Clarke", status: "finished", rating: 5 },
    "Four Thousand Weeks": { author: "Oliver Burkeman", status: "finished", rating: 4 },
    "The Design of Everyday Things": { author: "Don Norman", status: "reading", rating: 4 },
    "Tomorrow, and Tomorrow, and Tomorrow": { author: "Gabrielle Zevin", status: "up next", rating: 0 },
    "A Pattern Language": { author: "Christopher Alexander", status: "up next", rating: 0 },
};
const READING = Object.entries(BOOKS)
    .filter(([, book]) => book.status === "reading")
    .map(([title]) => title);

const PEOPLE = ["Priya", "Sam", "Jonah", "Mara"];
const PROJECTS = ["Project Atlas", "Kitchen renovation"];

const MOODS = ["focused", "calm", "tired", "energized", "scattered", "content", "restless"];

const MORNINGS = [
    "Up at 6:40 without the alarm. Coffee on the balcony while the street was still quiet.",
    "Slow start. Read in bed for half an hour before looking at my phone, which felt like a small win.",
    "Rain against the window all morning. Made porridge and wrote three pages longhand.",
    "Woke up with the whole [[Project Atlas]] navigation problem already rearranged in my head. Sketched it before it evaporated.",
    "Yoga, badly. Twenty minutes, most of it in child's pose.",
    "Walked to the bakery for sourdough. The owner remembered my order, which made my week.",
    "Alarm at seven, snoozed twice. Toast eaten standing up at the counter.",
    "Cycled the long way in, along the river. Mist on the water the whole way.",
    "Ten minutes of stretching, then a very strong coffee. Both necessary.",
    "Early train, empty carriage. Got through my inbox before the second stop.",
    "Grey and still outside. Made eggs and listened to the news without really hearing it.",
    "The neighbour's cat was on the balcony again, waiting to be let in. It is not my cat.",
    "Journalled for fifteen minutes before anyone else was awake.",
    "Slept badly, too warm. Opened every window and let the day start slowly.",
];

const RUNS = [
    ["Riverside loop", "Overcast, cool"],
    ["Park hill repeats", "Sunny, windy"],
    ["Canal towpath", "Light drizzle"],
    ["Old town circuit", "Clear and cold"],
];

/** Everyday work: lines that can come up again. */
const WORK = [
    "Weekly 1:1 with [[Sam]]. Talked through their priorities and what to drop.",
    "Pairing with [[Jonah]] on the sync code. Slow going, good conversation.",
    "Cleared the review queue before lunch, then went for a walk.",
    "Design crit for [[Project Atlas]]. Many opinions about spacing, few about anything else.",
    "Afternoon of deep work on the [[Project Atlas]] prototype, notifications off.",
    "Ran a user interview. Wrote up the notes while they were still fresh.",
    "Standup ran long again. Suggested we timebox it; everyone nodded, nobody meant it.",
    "Worked through a backlog of questions from [[Priya]]'s team.",
    "Sprint planning with [[Mara]]. Moved three tickets to later and felt lighter.",
    "Reviewed [[Jonah]]'s pull request. Mostly naming, one real bug.",
    "Spent the morning tidying design components nobody else will notice.",
    "Wrote the weekly update for the team. Kept it to five bullets.",
    "Lunch-and-learn on accessibility. Took more notes than I expected.",
    "Quiet day. Worked through small bugs and felt oddly satisfied.",
    "Too many meetings. Got an hour of real work done, right at the end of the day.",
    "Coffee walk with [[Priya]] instead of a meeting room. Better ideas that way.",
    "Triaged support tickets with [[Mara]]. Mostly the same three problems.",
    "Updated the [[Project Atlas]] research doc with this week's findings.",
    "Tried a new approach to the list view. Threw half of it away by five.",
    "Helped a new contractor set up. Realised how much of our setup lives only in my head.",
];

/**
 * Each week's one piece of news: told on a weekday, and remembered in Sunday's
 * review.
 */
const NEWS = [
    [
        "Design review for [[Project Atlas]]: the sidebar survives, the tab bar does not.",
        "Settled the sidebar question",
    ],
    ["Found the sync bug with [[Jonah]]: a race between two retries, not the cache.", "Finally found the sync bug"],
    [
        "Wrote up the research synthesis. Five interviews, one clear theme: people don't trust autosave.",
        "Research synthesis shared",
    ],
    [
        "Roadmap sync with [[Mara]]. We cut the export feature from this quarter, and everyone looked relieved.",
        "Cut export from the quarter",
    ],
    [
        "Shipped the settings redesign behind a flag. Watching the error dashboard like a hawk.",
        "Settings redesign shipped quietly",
    ],
    ["Prototyped the empty states. Three variations, the plainest one tested best.", "Empty states tested well"],
    [
        "Long 1:1 with [[Sam]] about career growth. Promised to find them a project with more ownership.",
        "Good career talk with [[Sam]]",
    ],
    [
        "Walked [[Priya]] through the new onboarding flow. She wants fewer steps; she's right.",
        "Onboarding down to three steps",
    ],
    [
        "Presented the [[Project Atlas]] prototype to leadership. They asked the right questions for once.",
        "The Atlas demo landed",
    ],
    [
        "Outage at 11am: a certificate expired. Back up in forty minutes, postmortem booked.",
        "Stayed calm through the outage",
    ],
    ["[[Jonah]] is leaving at the end of next month. Happy for them, sad for us.", "Planned [[Jonah]]'s handover"],
    [
        "Offer accepted by the new designer. [[Priya]] ran the final interview and called it early.",
        "Hiring done for the year",
    ],
    [
        "Accessibility audit came back: forty-one issues, most of them colour contrast.",
        "Started on the accessibility fixes",
    ],
    ["Offsite planning with [[Mara]]. We are going to a lake, apparently.", "Offsite booked"],
    ["Deleted two thousand lines of dead code. Nothing broke. Suspicious.", "Big cleanup merged"],
    [
        "First usability test of the new navigation. Four of five found settings without help.",
        "Navigation passed its first test",
    ],
].map(([news, review]) => ({ news, review }));

const TASKS = [
    "Reply to the landlord about the boiler",
    "Send [[Priya]] the updated flows",
    "Book dentist appointment",
    "Review [[Jonah]]'s pull request",
    "Order tiles for the [[Kitchen renovation]]",
    "Renew library card",
    "Draft the quarterly update",
    "Water the plants",
    "Pick up the dry cleaning",
    "Write feedback for [[Sam]]",
    "Call Mum",
    "Back up the laptop",
    "Pay the council tax",
    "Return the library books",
    "Fix the bike light",
    "Book train tickets for the offsite",
    "Update the [[Project Atlas]] roadmap",
    "Clean out the fridge",
    "Reply to [[Mara]] about the offsite",
    "Cancel the streaming subscription",
    "Get a haircut",
    "Sort the recycling",
    "Get quotes from two plumbers",
    "Buy a birthday card",
];

const EVENINGS = [
    `Read forty pages of [[${READING[0]}]] and fell asleep with the lamp on.`,
    "Cooked the miso aubergine from the green book. Too much miso, will do it again anyway.",
    "Dinner with [[Mara]] at the Georgian place. We talked about everything except work.",
    "Watched half a film, gave up, went to bed early. No regrets.",
    `Couple of chapters of [[${READING[1]}]]: slower going, but every page earns its place.`,
    "Long phone call with my sister. The kids have discovered knock-knock jokes.",
    "Played guitar for an hour. Finally got the barre chord in the bridge clean.",
    "Made a big pot of dal for the week. The flat smells wonderful.",
    "Evening swim. Thirty lengths and a long time in the sauna.",
    "Tidied the flat with a podcast on. Found three pens and a missing sock.",
    "Board games at [[Sam]]'s. Lost at everything, had a great time.",
    "Wrote a letter to my grandmother. Real paper, real stamp.",
    "Takeaway and a documentary about octopuses. Everything is octopuses now.",
    "Walked along the river until it got dark. Phone stayed in my pocket.",
];

const CALLOUTS = [
    ["idea", "Idea", "What if the daily note template asked one question instead of five?"],
    ["quote", "Quote", "“How we spend our days is, of course, how we spend our lives.” — Annie Dillard"],
    ["tip", "Note to self", "Block the first ninety minutes. Meetings can have the afternoon."],
    ["question", "Open question", "Is [[Project Atlas]] a redesign, or two products wearing one coat?"],
    ["tip", "Note to self", "No agenda, no meeting. Politely, but say it."],
    [
        "quote",
        "Quote",
        "“Nothing is less productive than to make more efficient what should not be done at all.” — Peter Drucker",
    ],
    ["idea", "Idea", "A weekly note that gathers every task left unchecked the week before."],
    ["question", "Open question", "Would I still do this work if nobody saw the results?"],
    ["tip", "Note to self", "When stuck, write the problem down as a question to someone else."],
];

const GRATITUDE = [
    "Sunlight through the kitchen window at 5pm",
    "A kind message from an old colleague",
    "The good pen turning up in a coat pocket",
    "Fresh bread",
    "[[Priya]]'s patience in a long meeting",
    "A quiet train home",
    "The first cold, clear morning of autumn",
    "A long lunch with nowhere to be",
    "Clean sheets",
    "The bus arriving just as I did",
    "A good book on a rainy afternoon",
    "Leftovers that were better the second day",
    "Laughing until it hurt at dinner",
    "The dog next door, who likes me",
    "[[Mara]] checking in after a hard day",
];

const WEEKEND = [
    "Farmers' market with [[Mara]]: figs, a ridiculous amount of cheese, flowers for the table.",
    "Hiked the ridge trail. 14 km, 600 m of climbing, one very muddy dog we didn't own.",
    "Spent the afternoon measuring the kitchen for the [[Kitchen renovation]]. The walls are not square. Nothing is square.",
    "Lazy one. Read in the park until the light went.",
    "Helped [[Sam]] move flat. Four flights of stairs, one sofa, zero lifts.",
    "Went to the museum's new photography exhibition. Stood in front of one print for ten minutes.",
    "Cycled out to the coast with [[Jonah]]. Chips on the harbour wall, headwind all the way home.",
    "Painted a sample of green on the wall for the [[Kitchen renovation]]. Hated it by evening.",
    "Did absolutely nothing until noon. Then a long bath and a longer nap.",
    "Car boot sale: a lamp, a teapot and a box of records I will never play.",
];

const SHORTFALLS = [
    "Too many late nights",
    "Skipped two runs",
    "Said yes to one meeting too many",
    "Barely read",
    "Ate lunch at my desk every day",
    "Checked email in bed",
    "Forgot to call Mum back",
    "Let the to-do list grow again",
];

const RECIPES = [
    [
        "### Sunday pasta",
        "",
        "1. Soften two shallots and a lot of garlic in butter",
        "2. Add a tin of tomatoes and a pinch of chilli, cook down for 20 min",
        "3. Finish with cream and parmesan, loosen with pasta water",
    ],
    [
        "### Roast squash soup",
        "",
        "1. Roast a squash with garlic and chilli until the edges catch",
        "2. Blend with stock and a spoon of miso",
        "3. Finish with yoghurt and toasted seeds",
    ],
    [
        "### Weekend flatbreads",
        "",
        "1. Flour, yoghurt, salt and baking powder, no rising",
        "2. Roll thin and cook in a dry pan",
        "3. Brush with garlic butter while hot",
    ],
];

const frontmatter = (properties) => [
    "---",
    ...Object.entries(properties).flatMap(([key, value]) =>
        Array.isArray(value) ? [`${key}:`, ...value.map((item) => `  - ${item}`)] : [`${key}: ${value}`]
    ),
    "---",
    "",
];

/**
 * Where a date is: its day since 1970, its week (starting Monday), and its day
 * in the week, with Monday as 0.
 */
const calendar = (date) => {
    const day = Date.parse(`${date}T00:00:00Z`) / DAY_MS;
    return { day, week: Math.floor((day + 3) / 7), weekday: (day + 3) % 7 };
};

/** The week's news, and the weekday it happens on. */
const newsOf = (week) => ({ ...deal(NEWS, week, 1)[0], weekday: picker(seeded(week)).between(0, 4) });

const tasks = ({ day }, pick) =>
    deal(TASKS, day, 4)
        .slice(0, pick.between(2, 4))
        .map((task) => `- [${pick.chance(0.55) ? "x" : " "}] ${task}`);

const runTable = (pick) => {
    const [route, weather] = pick.one(RUNS);
    const km = pick.between(5, 12);
    const pace = `${pick.between(4, 5)}:${String(pick.between(10, 55)).padStart(2, "0")}`;
    return [
        "## Run",
        "",
        "| Route | Distance | Pace | Weather |",
        "| --- | --- | --- | --- |",
        `| ${route} | ${km} km | ${pace} /km | ${weather} |`,
    ];
};

/**
 * A quarter of weekdays get only a line or two, because a real journal has
 * short days, and several fit on one screen.
 */
const weekday = (date, when, pick) => {
    const properties = frontmatter({
        tags: ["daily", "work"],
        mood: pick.one(MOODS),
        sleep: pick.between(10, 17) / 2,
    });
    const sketch = date.endsWith("-16") ? ["### Sketch", "", "![[atlas-wireframe.svg]]", ""] : [];
    const news = newsOf(when.week);
    const work = [...(news.weekday === when.weekday ? [news.news] : []), ...deal(WORK, when.day, 2)];
    const evening = deal(EVENINGS, when.day, 1)[0];
    if (pick.chance(0.25)) {
        return [...properties, "## Notes", "", `- ${work[0]}`, "", ...sketch, evening];
    }
    const callout = pick.chance(0.35) ? deal(CALLOUTS, when.day, 1)[0] : null;
    return [
        ...properties,
        "## Morning",
        "",
        deal(MORNINGS, when.day, 1)[0],
        "",
        ...(pick.chance(0.3) ? [...runTable(pick), ""] : []),
        "## Work",
        "",
        ...work.slice(0, pick.between(1, 2)).map((line) => `- ${line}`),
        "",
        ...sketch,
        "### To do",
        "",
        ...tasks(when, pick),
        "",
        ...(callout ? [`> [!${callout[0]}] ${callout[1]}`, `> ${callout[2]}`, ""] : []),
        "## Evening",
        "",
        evening,
    ];
};

const saturday = ({ week }, pick) => [
    ...frontmatter({ tags: ["daily", "weekend"], mood: pick.one(MOODS) }),
    "## Saturday",
    "",
    deal(WEEKEND, week, 1)[0],
    "",
    ...(pick.chance(0.5) ? [...runTable(pick), ""] : []),
    "## Grateful for",
    "",
    ...deal(GRATITUDE, week, 3).map((line, index) => `${index + 1}. ${line}`),
];

const sunday = (when, pick) => [
    ...frontmatter({ tags: ["daily", "weekend", "review"], mood: pick.one(MOODS) }),
    "## Week in review",
    "",
    "### Went well",
    "",
    `- ${newsOf(when.week).review}`,
    "",
    "### Could be better",
    "",
    `- ${deal(SHORTFALLS, when.week, 1)[0]}`,
    "",
    "### Reading",
    "",
    "![[Reading.base]]",
    "",
    ...(pick.chance(0.5) ? [...deal(RECIPES, when.week, 1)[0], ""] : []),
    "## Next week",
    "",
    ...tasks(when, pick),
];

const dailyNote = (date) => {
    const pick = picker(seeded(Number(date.replaceAll("-", ""))));
    const when = calendar(date);
    const lines =
        when.weekday === 6 ? sunday(when, pick) : when.weekday === 5 ? saturday(when, pick) : weekday(date, when, pick);
    return lines.join("\n") + "\n";
};

/**
 * Whether `date` is left without writing. The same on every run, like its note.
 */
const isUnwritten = (date) => seeded(hash(date))() < UNWRITTEN_ODDS;

const READING_BASE = [
    "filters:",
    "  and:",
    '    - file.inFolder("Books")',
    "views:",
    "  - type: table",
    "    name: Reading",
    "    order:",
    "      - file.name",
    "      - author",
    "      - status",
    "      - rating",
    "    summaries:",
    "      rating: Average",
];

const WIREFRAME = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280" viewBox="0 0 480 280" font-family="sans-serif">',
    '  <rect width="480" height="280" rx="12" fill="#f4f1ea" stroke="#8a8373" stroke-width="2"/>',
    '  <rect x="16" y="16" width="112" height="248" rx="6" fill="#e3ddd0"/>',
    ...[40, 64, 88, 112].map((y) => `  <rect x="28" y="${y}" width="80" height="10" rx="5" fill="#b8ae9a"/>`),
    '  <rect x="144" y="16" width="320" height="40" rx="6" fill="#e3ddd0"/>',
    '  <rect x="144" y="72" width="152" height="192" rx="6" fill="#fff" stroke="#b8ae9a"/>',
    '  <rect x="312" y="72" width="152" height="192" rx="6" fill="#fff" stroke="#b8ae9a"/>',
    '  <text x="220" y="172" font-size="14" fill="#8a8373" text-anchor="middle">list</text>',
    '  <text x="388" y="172" font-size="14" fill="#8a8373" text-anchor="middle">detail</text>',
    "</svg>",
];

const personNote = (name) =>
    [...frontmatter({ tags: ["person"] }), `# ${name}`, "", "Works with me on [[Project Atlas]]."].join("\n") + "\n";

/**
 * Each project's log of the newest days, with `dates[0]` the newest. This is
 * what gives those days' notes linked mentions. The renovation starts from a
 * property. A run with fewer days than the log links its oldest day instead of
 * the days it does not have.
 */
const projectNote = (name, dates, unwritten) => {
    const recent = (daysBack) => dates[Math.min(daysBack, dates.length - 1)];
    return (
        {
            "Project Atlas": [
                "# Project Atlas",
                "",
                "## Log",
                "",
                `- [[${recent(0)}]] — the sidebar survives, the tab bar does not`,
                `- [[${recent(1)}]] — sync bug is a race between two retries`,
                `- [[${recent(3)}]] — onboarding down to three steps`,
            ],
            "Kitchen renovation": [
                ...frontmatter({ started: `"[[${recent(4)}]]"` }),
                "# Kitchen renovation",
                "",
                `Tiles ordered on [[${recent(0)}]]. None of the walls are square.`,
                ...(unwritten ? ["", `The plumber came round on [[${unwritten}]].`] : []),
            ],
        }[name].join("\n") + "\n"
    );
};

const bookNote = ([title, { author, status, rating }]) =>
    [...frontmatter({ author, status, rating: rating || "", tags: ["book"] }), `# ${title}`, ""].join("\n") + "\n";

/**
 * The vault as `{ path: contents }`: `days` daily notes ending on `until`, and
 * all they link to.
 * @param {{ until: Date, days: number }} range
 * @returns {Record<string, string>}
 */
export function demoVault({ until, days }) {
    /** @type {Record<string, string>} */
    const vault = {};
    const dates = Array.from({ length: days }, (_, index) =>
        new Date(until.getTime() - index * DAY_MS).toISOString().slice(0, 10)
    );
    // The newest note always has writing, because it is at the top of the
    // stream and of every screenshot.
    const unwritten = dates.filter((date, index) => index > 0 && isUnwritten(date));
    for (const date of dates) {
        vault[`${JOURNAL}/${date}.md`] = unwritten.includes(date) ? TEMPLATE.join("\n") : dailyNote(date);
    }
    vault[`${DAILY_TEMPLATE}.md`] = TEMPLATE.join("\n");
    for (const book of Object.entries(BOOKS)) vault[`Books/${book[0]}.md`] = bookNote(book);
    for (const name of PEOPLE) vault[`People/${name}.md`] = personNote(name);
    for (const name of PROJECTS) vault[`Projects/${name}.md`] = projectNote(name, dates, unwritten[0]);
    vault["Reading.base"] = READING_BASE.join("\n") + "\n";
    vault["Attachments/atlas-wireframe.svg"] = WIREFRAME.join("\n") + "\n";
    return vault;
}

/**
 * Makes `folders` in `vault` hold exactly `files`, and only writes what is
 * different. In an iCloud vault, a note deleted and written again while a
 * device has it open comes back next to itself as "Mara 2.md".
 */
export function writeVault(vault, files, folders) {
    for (const folder of folders) {
        const root = join(vault, folder);
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
            const path = join(entry.parentPath, entry.name);
            const relative = path.slice(vault.length + 1);
            if (entry.isFile() && !(relative in files)) rmSync(path);
        }
    }
    for (const [relative, contents] of Object.entries(files)) {
        const target = join(vault, relative);
        if (existsSync(target) && readFileSync(target, "utf8") === contents) continue;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents);
    }
}

export function main() {
    const args = process.argv.slice(2);
    const flag = (name) => {
        const index = args.indexOf(name);
        return index === -1 ? undefined : args[index + 1];
    };
    const positional = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
    const vault = resolve(positional[0] ?? DEMO_VAULT);
    const days = Number(flag("--days") ?? 90);
    const now = new Date();
    const until = flag("--until")
        ? new Date(`${flag("--until")}T00:00:00Z`)
        : new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    if (!Number.isInteger(days) || days < 1 || Number.isNaN(until.getTime())) {
        console.error("Usage: pnpm run seed [vault] [--days N] [--until YYYY-MM-DD]");
        process.exit(1);
    }

    const write = (relative, contents) => {
        const target = join(vault, relative);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents);
    };
    const writeConfigOnce = (relative, value) => {
        if (!existsSync(join(vault, relative))) write(relative, JSON.stringify(value, null, 2));
    };

    writeVault(vault, demoVault({ until, days }), [JOURNAL, "Books", "People", "Projects", "Attachments", "Templates"]);

    writeConfigOnce(".obsidian/daily-notes.json", { folder: JOURNAL, format: "YYYY-MM-DD", template: DAILY_TEMPLATE });
    writeConfigOnce(".obsidian/core-plugins.json", { "daily-notes": true, bases: true });
    writeConfigOnce(".obsidian/community-plugins.json", [PLUGIN_ID]);
    writeConfigOnce(".obsidian/app.json", { attachmentFolderPath: "Attachments" });

    installBuild(vault);

    console.log(`Wrote ${days} journal entries up to ${until.toISOString().slice(0, 10)} into ${vault}`);
}

if (isMain(import.meta.url)) main();
