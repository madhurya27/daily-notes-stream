import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";

/**
 * Rules for code inside the app: popout windows, mobile, the vault's config
 * folder. Scripts and tests run in Node.
 */
const offOutsideTheApp = {
    "obsidianmd/no-nodejs-modules": "off",
    "obsidianmd/hardcoded-config-path": "off",
    "obsidianmd/prefer-window-timers": "off",
    "obsidianmd/prefer-instanceof": "off",
} as const;

export default tseslint.config(
    {
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
    ...obsidianmd.configs.recommended,
    // The obsidian mock hands tests the real moment, because Obsidian's own
    // moment is what the plugin calls at run time: a stand-in that only spoke
    // ISO would pass every test a vault dated DD-MM-YYYY fails. Dev-only —
    // `obsidian` is external, so the bundle takes moment from the app.
    {
        files: ["package.json"],
        rules: { "depend/ban-dependencies": ["error", { allowed: ["moment"] }] },
    },
    // The plugin's name is a proper noun, title case as the manifest has it (D-162).
    {
        files: ["src/**/*.ts"],
        rules: {
            "obsidianmd/ui/sentence-case": [
                "warn",
                { enforceCamelCaseLower: true, ignoreRegex: ["^Daily Notes Stream$"] },
            ],
        },
    },
    // Submission rules the recommended config leaves out, for the shipped code.
    {
        files: ["src/**/*.ts"],
        rules: {
            "no-console": ["error", { allow: ["error"] }],
            // The global app exists for debugging and may be withdrawn.
            "no-restricted-properties": ["error", { object: "window", property: "app", message: "Use this.app." }],
            "no-restricted-syntax": [
                "error",
                {
                    selector: "ImportDeclaration[source.value='electron']",
                    message: "Electron is desktop-only; the manifest promises mobile.",
                },
                // A placeholder's height is measured at runtime, so custom
                // properties may be set from code (docs/DECISIONS.md, D-003).
                // An inline overflow-x may be cleared, which only !important
                // would outrank (D-172).
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
                // Rebuilt elements would pile registrations on the view; delegate
                // to one listener on the container instead.
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
    // manifest.json, for validate-manifest; parsed as JSON by the TS parser.
    {
        files: ["manifest.json"],
        languageOptions: { parser: tseslint.parser },
        plugins: { obsidianmd },
        rules: { "obsidianmd/validate-manifest": "error" },
    },
    // Node scripts, not plugin code: Node globals, and no typed linting to
    // configure since they sit outside every tsconfig.
    {
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            globals: { ...globals.node },
            parserOptions: { projectService: false },
        },
        extends: [tseslint.configs.disableTypeChecked],
        rules: {
            ...offOutsideTheApp,
            // A script's console is its output.
            "obsidianmd/rule-custom-message": "off",
        },
    },
    // Tests run in Node under vitest, never inside the app: the rules that
    // guard the shipped plugin's runtime don't apply. unbound-method misreads
    // `expect(mock.method)`, which never calls the method.
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
            // Tests stand in for Obsidian and Bases, which style inline.
            "obsidianmd/no-static-styles-assignment": "off",
        },
    },
    // Last: turns off stylistic rules that would fight Prettier.
    prettier,
    globalIgnores([
        "node_modules",
        "coverage",
        "dist",
        "esbuild.config.mjs",
        "stryker.config.mjs",
        "eslint.config.mts",
        "versions.json",
        "main.js",
        ".dev",
        "vitest.config.ts",
        // Typechecked by e2e-tests/tsconfig.json; ESLint's project service covers src and tests.
        "e2e-tests",
        "playwright.config.ts",
        "playwright.ios.config.ts",
    ])
);
