import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import stylistic from "@stylistic/eslint-plugin";

/**
 * Rules for code that runs inside the app: pop-out windows, mobile, and the
 * vault's config folder. Scripts and tests run in Node.
 */
const offOutsideTheApp = {
    "obsidianmd/no-nodejs-modules": "off",
    "obsidianmd/hardcoded-config-path": "off",
    "obsidianmd/prefer-window-timers": "off",
    "obsidianmd/prefer-instanceof": "off",
} as const;

/**
 * Files only checked for comment width. They run in Node or in Playwright, and
 * the full rules misfire on them: the type rules on untyped `page.evaluate`
 * code, and the rules for code that runs inside Obsidian.
 */
const commentWidthOnly = [
    "e2e-tests/**/*.ts",
    "playwright.config.ts",
    "playwright.ios.config.ts",
    "vitest.config.ts",
    "esbuild.config.mjs",
    "stryker.config.mjs",
    "eslint.config.mts",
];

/** `configs` with `commentWidthOnly` added to each one's ignores. */
const notForCommentWidthOnly = <T extends { ignores?: string[] }>(configs: T[]): T[] =>
    configs.map((config) => ({ ...config, ignores: [...(config.ignores ?? []), ...commentWidthOnly] }));

export default tseslint.config(
    {
        ignores: commentWidthOnly,
        languageOptions: {
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: ["eslint.config.js", "manifest.json"],
                },
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: [".json"],
            },
        },
    },
    ...notForCommentWidthOnly(obsidianmd.configs.recommended),
    // The obsidian mock gives tests the real moment, because the plugin calls
    // Obsidian's own moment when it runs. A fake that only understood ISO would
    // pass tests that a vault dated DD-MM-YYYY fails. Only used in development:
    // `obsidian` is not bundled, so the bundle gets moment from the app.
    {
        files: ["package.json"],
        rules: { "depend/ban-dependencies": ["error", { allowed: ["moment"] }] },
    },
    // The plugin's name is a proper noun, in title case as in the manifest
    // (D-162).
    {
        files: ["src/**/*.ts"],
        rules: {
            "obsidianmd/ui/sentence-case": [
                "warn",
                { enforceCamelCaseLower: true, ignoreRegex: ["^Daily Notes Stream$"] },
            ],
        },
    },
    // Submission rules that the recommended config does not include, for the
    // code that ships.
    {
        files: ["src/**/*.ts"],
        rules: {
            "no-console": ["error", { allow: ["error"] }],
            // The global app exists for debugging and may be removed.
            "no-restricted-properties": ["error", { object: "window", property: "app", message: "Use this.app." }],
            "no-restricted-syntax": [
                "error",
                {
                    selector: "ImportDeclaration[source.value='electron']",
                    message: "Electron is desktop-only; the manifest promises mobile.",
                },
                // An empty block's height is measured while running, so custom
                // properties may be set from code (docs/DECISIONS.md, D-003).
                // An inline overflow-x may be cleared, because only !important
                // would beat it (D-172).
                {
                    selector:
                        "CallExpression[callee.property.name='setProperty'][callee.object.property.name='style'][arguments.0.value!=/^--/]",
                    message: "Style through CSS classes; only custom properties may be set from code.",
                },
                {
                    selector:
                        "CallExpression[callee.property.name='removeProperty'][callee.object.property.name='style'][arguments.0.value!=/^(--|overflow-x$)/]",
                    message: "Style through CSS classes; only custom properties may be set from code.",
                },
                {
                    selector: "CallExpression[callee.property.name='setCssStyles']",
                    message: "Style through CSS classes; only custom properties may be set from code.",
                },
                // Elements created again would pile up registrations on the
                // view. Use one listener on the container instead.
                {
                    selector: "CallExpression[callee.property.name=/^(addEventListener|onClickEvent)$/]",
                    message: "Register listeners through the owning component (registerDomEvent).",
                },
            ],
        },
    },
    {
        files: ["src/**/*.ts"],
        ignores: ["src/notes/moment.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "obsidian",
                            importNames: ["moment"],
                            message: "Import moment from src/notes/moment.ts, which the scorecard can type (D-152).",
                        },
                    ],
                },
            ],
        },
    },
    // manifest.json, for validate-manifest. The TS parser reads it as JSON.
    {
        files: ["manifest.json"],
        languageOptions: { parser: tseslint.parser },
        plugins: { obsidianmd },
        rules: { "obsidianmd/validate-manifest": "error" },
    },
    // Node scripts, not plugin code: Node globals, and no type-aware linting to
    // set up, because they are outside every tsconfig.
    {
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            globals: { ...globals.node },
            parserOptions: { projectService: false },
        },
        extends: [tseslint.configs.disableTypeChecked],
        rules: {
            ...offOutsideTheApp,
            // A script's console output is what it is for.
            "obsidianmd/rule-custom-message": "off",
        },
    },
    // Tests run in Node with vitest, never inside the app, so the rules that
    // protect the shipped plugin while it runs don't apply. unbound-method
    // misunderstands `expect(mock.method)`, which never calls the method.
    {
        files: ["tests/**/*.ts"],
        languageOptions: { globals: { ...globals.node } },
        rules: {
            ...offOutsideTheApp,
            "import/no-nodejs-modules": "off",
            "@microsoft/sdl/no-inner-html": "off",
            "no-unsanitized/property": "off",
            "no-restricted-imports": "off",
            "@typescript-eslint/no-restricted-imports": "off",
            "obsidianmd/no-global-this": "off",
            "obsidianmd/prefer-create-el": "off",
            "@typescript-eslint/unbound-method": "off",
            // Tests act as Obsidian and Bases, which set inline styles.
            "obsidianmd/no-static-styles-assignment": "off",
        },
    },
    // Turns off style rules that would conflict with Prettier.
    prettier,
    // Parsed without type information, for the comment width rule below.
    {
        files: commentWidthOnly,
        languageOptions: { parser: tseslint.parser, parserOptions: { projectService: false } },
    },
    // After Prettier's config, which turns max-len off. Prettier wraps code but
    // never comments, so this checks comment lines only: 80 columns, counting
    // indentation. Directive lines, JSDoc type definitions and URLs cannot
    // wrap, so they may be longer.
    {
        plugins: { "@stylistic": stylistic },
        rules: {
            "@stylistic/max-len": [
                "error",
                {
                    code: 1000,
                    comments: 80,
                    ignoreUrls: true,
                    ignorePattern: "(Stryker (disable|restore)|eslint-disable|@typedef)",
                },
            ],
        },
    },
    globalIgnores(["node_modules", "coverage", "dist", "versions.json", "main.js", ".dev"])
);
