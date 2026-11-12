import { describe, it, expect } from "vitest";
import { isTemplateOnly, templatePattern } from "../../src/notes/template-match";

/** Whether `text` is `template` and nothing more. */
function matches(text: string, template: string | null): boolean {
    return isTemplateOnly(text, templatePattern(template));
}

const TEMPLATE = "---\ntags: daily\ncreated: {{date}}\n---\n# {{date:dddd, MMMM D}}\n\n## Log\n- \n";

describe("templatePattern", () => {
    it("holds for blank text, whatever the template", () => {
        expect(matches("", TEMPLATE)).toBe(true);
        expect(matches(" \n\t\n", TEMPLATE)).toBe(true);
    });

    it("holds, with no template, for blank text alone", () => {
        expect(matches("", null)).toBe(true);
        expect(matches(" \n", null)).toBe(true);
        expect(matches("Stryker was here!", null)).toBe(false);
    });

    it("holds for the template with its placeholders filled in", () => {
        const text = "---\ntags: daily\ncreated: 2026-09-28\n---\n# Monday, September 28\n\n## Log\n- \n";

        expect(matches(text, TEMPLATE)).toBe(true);
    });

    it.each(["{{date}}", "{{date:YYYY-MM-DD}}", "{{date+1d:YYYY-MM-DD}}", "{{yesterday}}", "{{ time }}"])(
        "reads %s as any text on its line",
        (placeholder) => {
            expect(matches("Day: 2026-09-27", `Day: ${placeholder}`)).toBe(true);
            expect(matches("Day: ", `Day: ${placeholder}`)).toBe(true);
            expect(matches("Day: 2026\nwritten", `Day: ${placeholder}`)).toBe(false);
        }
    );

    it.each(["<% tp.file.title %>", "<%* tR += tp.date.now() %>", "<%_ tp.date.now() _%>", "<%- tp.file.title -%>"])(
        "reads the Templater block %s as any text on its line",
        (block) => {
            expect(matches("Day: 2026-09-27", `Day: ${block}`)).toBe(true);
            expect(matches("Day: ", `Day: ${block}`)).toBe(true);
            expect(matches("Day: 2026\nwritten", `Day: ${block}`)).toBe(false);
        }
    );

    it.each(["<% tp.file.cursor() %>", "<% tp.file.cursor(1) %>", "<%tp.file.cursor()%>"])(
        "reads %s as nothing: Templater leaves the cursor there, not text",
        (cursor) => {
            const template = `## Notes\n- ${cursor}\n\n## Events\n- \n`;

            expect(matches("## Notes\n- \n\n## Events\n- \n", template)).toBe(true);
            expect(matches("## Notes\n- Called Mara\n\n## Events\n- \n", template)).toBe(false);
        }
    );

    it.each(["<%- tp.file.cursor() %>", "<% tp.file.cursor() -%>", "<%_ tp.file.cursor() _%>"])(
        "reads %s, its whitespace controlled, as nothing too",
        (cursor) => {
            expect(matches("Notes:", `Notes: ${cursor}`)).toBe(true);
            expect(matches("Notes: Called Mara", `Notes: ${cursor}`)).toBe(false);
        }
    );

    it("reads tp.file.cursor() as the marker Templater writes back, until it jumps there", () => {
        const template = "## Notes\n- <% tp.file.cursor() %>\n";

        expect(matches("## Notes\n- <% tp.file.cursor() %>\n", template)).toBe(true);
        expect(matches("## Notes\n- <% tp.file.cursor(2) %>\n", template)).toBe(true);
        expect(matches("## Notes\n- <% tp.file.cursor() %> Called Mara\n", template)).toBe(false);
    });

    it("reads a cursor on the last line as nothing, the blank lines before it trimmed with it", () => {
        const template = "## Tasks\n- [ ] \n\n<% tp.file.cursor() %>\n";

        expect(matches("## Tasks\n- [ ] \n\n", template)).toBe(true);
        expect(matches("## Tasks\n- [ ] \n\n<% tp.file.cursor() %>\n", template)).toBe(true);
        expect(matches("## Tasks\n- [ ] \n\nCalled Mara\n", template)).toBe(false);
    });

    it("reads placeholders closing the template, filled with nothing, as trimmed with the blank lines before them", () => {
        const template = "A\n\n{{date}}\n\n{{time}}";

        expect(matches("A", template)).toBe(true);
        expect(matches("A\n\n2026-10-11", template)).toBe(true);
        expect(matches("A\n\n2026-10-11\n\n09:00", template)).toBe(true);
        expect(matches("A\n2026-10-11", template)).toBe(false);
        expect(matches("A\n\n2026-10-11\nwritten", template)).toBe(false);
    });

    it("reads a template of a placeholder alone as any one line", () => {
        expect(matches("2026-10-15", "{{date}}")).toBe(true);
        expect(matches("2026-10-15\nwritten", "{{date}}")).toBe(false);
    });

    it("still wants the text after a placeholder", () => {
        expect(matches("A", "A\n{{date}}\nB")).toBe(false);
    });

    it("reads an indented placeholder filled with nothing as a blank line", () => {
        expect(matches("A\n\nB", "A\n  {{date}}\nB")).toBe(true);
    });

    it("still wants blank lines the template keeps between text", () => {
        expect(matches("A\nB", "A\n\nB")).toBe(false);
    });

    it.each([
        ["-%> drops the one newline after it", "A\n<%* x -%>\nB\n\nC", "A\nB\n\nC"],
        ["<%- drops the one newline before it", "A\n\n<%- x %>\nB", "A\n\nB"],
        ["_%> drops all whitespace after it", "A\n<%* x _%>\n\n  B", "A\nB"],
        ["<%_ drops all whitespace before it", "A\n\n\n<%_ x %>B", "AB"],
        ["-%> drops a newline only right after it", "A <%* x -%>B\nC", "A B\nC"],
        ["<%- drops a newline only right before it", "A\nB <%- x %>", "A\nB"],
        ["_%> drops whitespace only right after it", "A<%* x _%>B C", "AB C"],
        ["<%_ drops whitespace only right before it", "A B\n<%_ x %>C", "A BC"],
    ])("follows Templater's whitespace control: %s", (_, template, filled) => {
        expect(matches(filled, template)).toBe(true);
        expect(matches(`${filled}\nwritten`, template)).toBe(false);
    });

    it("ignores trailing whitespace on each line and at the end", () => {
        expect(matches("## Log\n-\n\n\n", "## Log\n- \n")).toBe(true);
        expect(matches("## Log  \n- ", "## Log\n-")).toBe(true);
    });

    it("ignores Windows and classic Mac line endings", () => {
        expect(matches("## Log\r\n- \r\n", "## Log\n- \n")).toBe(true);
        expect(matches("## Log\r- \r", "## Log\n- \n")).toBe(true);
    });

    it("takes the template's text literally, regex characters included", () => {
        expect(matches("Mood (1-5): [ ]", "Mood (1-5): [ ]")).toBe(true);
        expect(matches("Mood (1-5): x", "Mood (1-5): [ ]")).toBe(false);
    });

    it("fails for a filled-in prompt", () => {
        expect(matches("## Log\n- went running\n", "## Log\n- \n")).toBe(false);
    });

    it("fails for text added after the template", () => {
        expect(matches("## Log\n- \n\nA thought.", "## Log\n- \n")).toBe(false);
    });

    it("fails for a changed or an added property", () => {
        const changed = "---\ntags: work\ncreated: 2026-09-28\n---\n# Monday, September 28\n\n## Log\n- \n";
        const added = "---\ntags: daily\nmood: good\ncreated: 2026-09-28\n---\n# Monday, September 28\n\n## Log\n- \n";

        expect(matches(changed, TEMPLATE)).toBe(false);
        expect(matches(added, TEMPLATE)).toBe(false);
    });
});
