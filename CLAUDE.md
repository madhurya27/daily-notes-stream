# CLAUDE.md

An Obsidian plugin that shows all daily notes as one read-only page that loads
more as you scroll. The design and a map of the files are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The rules in `.claude/rules/` load
when you work on the files each one names.

## Commands

```bash
pnpm install
pnpm run dev            # rebuild main.js on every save
pnpm run build          # check types, then build main.js for release (esbuild, CommonJS; `obsidian` is not bundled)
pnpm run build:device   # the same, but the plugin shows a two-word name for the build when it loads, so you can tell builds apart on a phone
pnpm run install:vault <vault>   # build:device, then copy it into <vault>'s plugin folder; notes and settings are not touched
pnpm run lint           # ESLint
pnpm run format         # Prettier --write; format:check only checks. Markdown wraps at 80 columns, except README.md (never wrapped, D-155) and AGENTS.md.
                        # Prettier never wraps comments: wrap them by hand at 80 columns, indentation included. Lint checks it (D-175).
pnpm test               # check the types in tests/ (tests/tsconfig.json), then run vitest
pnpm run test:coverage  # the same, and require 100% coverage
pnpm run test:mutation  # Stryker on src/, only what changed; results in reports/ (D-141); no mutant may survive (D-149)
                        # Run it once per change, after its tests are final. After changing a test: --force --mutate <the src file it tests>; almost never a bare --force.
                        # To compare surviving mutants, copy reports/ first. Never run it again on main.
pnpm run test:e2e       # build, check e2e types, then run Playwright against real Obsidian; downloads Dataview into .dev/ the first time
pnpm exec playwright install webkit   # once, for e2e-tests/webkit.spec.ts
pnpm run test:ios       # build, then run e2e-tests/ios/ on a plugged-in, unlocked iPhone (ADR 0016); setup is in docs/TESTING.md
pnpm run test:ipados    # the same on a plugged-in iPad, keyboard attached or not (D-169, D-174), in landscape, then the @portrait tests upright (D-193)
IOS_SEED_DAYS=1825 pnpm run test:ios   # the same on five years of notes (D-158); about 7 min, the same as on 21 days
xcrun devicectl list devices   # which device is connected? Don't use system_profiler: it misses it
GLIDE_SWEEP=1 pnpm run test:ipados stream.spec.ts -g sweep --max-failures=0
                        # one kind of embed at a time rendering in a glide's path, to find what disturbs it (D-191); about 10 min
pnpm run test:memory    # tests of memory, render cost and edit cost, on a five-year test vault (E2E_SEED_DAYS)
SCROLL_COST=1 E2E_SEED_DAYS=365 pnpm exec playwright test scroll-cost --project=desktop
                        # scrolls with a real mouse wheel on a slowed CPU; RATES, SPEEDS, DOWN_UP=1 and SCREEN=4k175 change the test
# Every test run stops at the first failure. To see every failure: --max-failures=0 (Playwright), --bail=0 (vitest)
pnpm run test:e2e webkit.spec.ts --repeat-each=10   # flags and files go straight after the script: after a `--`, Playwright ignores them

pnpm run demo                     # open .dev/demo-vault/ (gitignored) and reload the plugin on every save; Ctrl-C closes it
                                  # it fills the vault again each time and builds if needed; --desktop, --ipad; --help lists the flags
pnpm run build && pnpm run seed   # fill .dev/demo-vault/ again with a realistic journal, and install the build in it
# --test on demo and seed: use .dev/vault/ instead, the vault of edge cases that docs/TESTING.md is written for
```

## Releases

Raise the version with `pnpm version`, merge, then push the tag. The workflow
then drafts the release with its files. pnpm names the tag `v1.0.0` and ignores
`.npmrc`, but the workflow needs `1.0.0`, so change the tag before you push it.
Since `1.0.0`, write each release's notes from
`git log --first-parent <last tag>..`: in plain words, say what a reader will
notice. Then publish the release (D-115).

To clear warnings in the directory's scorecard, the user first runs **Review
branch → Run preview scan** on the branch or tag, in the plugin's listing. After
the release is published, **... → Check for new releases** finds it straight
away.

## Quality gates

Run all of `pnpm run test:e2e` only when you change what ships to users or what
every test uses: `src/`, `styles.css`, `manifest.json`, the build
(`esbuild.config.mjs`, `tsconfig.json`, dependencies), `e2e-tests/obsidian.ts`,
`e2e-tests/global-setup.ts` or `playwright.config.ts`. When you change other e2e
code, run the tests that use it. Any other change needs the other checks, and a
run of whatever it affects.

CI (`.github/workflows/ci.yml`) runs every check except e2e, on Linux. The e2e
tests are run on this Mac (D-148).

## Tests

- `e2e-tests/ios/` controls Obsidian on a real iPhone, with real touches, real
  scrolling and real rotation
  ([ADR 0016](docs/adr/0016-drive-a-real-iphone.md)). Run it for any change to
  how the stream scrolls, loads or rotates, on whichever device is on USB:
  `test:ios` for the iPhone, `test:ipados` for the iPad. In
  `xcrun devicectl list devices --json-output <file>`, a device on USB has
  `transportType` `wired`. Ask me to plug in the other one only when the change
  touches what differs between them (the navbar, an iPad's keyboard) or how the
  tests touch the screen, and then once, at the end.
- **Look at a change to the screen before you hand it over.** Take screenshots
  with the e2e tests, on desktop and mobile, and look at them. Measurements
  prove that a rule was followed, not that the result looks right.

## Documentation

Update the docs in the same branch as the change that makes them out of date:

- `docs/adr/` — one numbered record for each decision that is not obvious. The
  reasons and the rejected options are written _only_ here; everything else
  links to it.
- `docs/DECISIONS.md` — smaller decisions: the decision, why, and what was
  rejected. Refer to one by its ID, such as `D-023`.
- `README.md` — features, install and use, for users.
- `docs/TESTING.md` — a list of things to check by hand.
- `docs/LISTING.md` — the descriptions in the plugin directory. Copy a change
  into the listing by hand.
- `docs/TODO.md` — work still to do. Delete an item when it ships; the merges on
  `main` record what shipped.
- `AGENTS.md` — copied word for word from the sample plugin. Change the code to
  match it, never the other way round. The exception is its npm commands: this
  repo uses pnpm.
- `docs/ARCHITECTURE.md` — layers, which part owns what, how data flows, and a
  map of the files.
- `docs/plans/` — plans and design notes. Gitignored, so never committed. Before
  a plan is deleted, move what should last into an ADR or a `D-` entry.
- This file and `.claude/rules/` — commands, rules that must always hold, and
  instructions.
