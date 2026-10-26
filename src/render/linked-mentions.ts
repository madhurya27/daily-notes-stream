import { MarkdownRenderer, Platform, type App, type Component, type TFile } from "obsidian";
import type { BacklinkIndex } from "../notes/backlink-index";
import { linkedMentions, mentionsSignature, type Mention } from "../notes/linked-mentions";
import type { DailyNotesStreamSettings } from "../settings";
import { LINKED_MENTIONS_SECTION_KEY, type CollapsibleManager } from "./collapsible";
import type { WidthWatch } from "./note-widths";
import { fitWideEquations } from "./wide-equations";
import { stackWideTables } from "./wide-tables";

/**
 * The notes that link to a daily note, shown under it. The heading and count
 * come from the cache, so they are drawn at once. The excerpts need each other
 * note to be read, so they are drawn later, and only while the section is
 * unfolded.
 */
export class LinkedMentionsFooter {
    constructor(
        private readonly app: App,
        private readonly index: BacklinkIndex,
        private readonly collapsible: CollapsibleManager,
        private readonly getSettings: () => DailyNotesStreamSettings,
        private readonly widths: WidthWatch,
        /**
         * What is done to the note's own content once drawn: links to notes
         * that don't exist are faded.
         */
        private readonly decorate: (el: HTMLElement) => void
    ) {}

    /**
     * Adds the footer to `block`. Resolves once it is drawn, so its note's
     * height can be held until then. It draws itself again when the cache
     * resolves a change it shows, until `note` unloads.
     */
    render(block: HTMLElement, file: TFile, note: Component): Promise<void> {
        if (!this.getSettings().showLinkedMentions) return Promise.resolve();

        const el = block.createDiv({ cls: "daily-note-mentions" });
        let unloaded = false;
        note.register(() => (unloaded = true));
        let signature: string;
        let generation = 0;

        const fill = (mentions: Mention[]): Promise<void> => {
            signature = mentionsSignature(mentions);
            // Stryker disable next-line UpdateOperator: counting down would also give each fill its own number.
            const current = ++generation;
            el.empty();
            if (mentions.length === 0) return Promise.resolve();
            return this.drawHeaded(el, file, mentions, note, () => unloaded || current !== generation);
        };

        note.registerEvent(
            this.app.metadataCache.on("resolved", () => {
                if (unloaded) return;
                const mentions = linkedMentions(this.app, this.index, file);
                if (mentionsSignature(mentions) !== signature) void fill(mentions);
            })
        );
        return fill(linkedMentions(this.app, this.index, file));
    }

    /** Draws the heading, and the mentions under it once unfolded. */
    private drawHeaded(
        el: HTMLElement,
        file: TFile,
        mentions: readonly Mention[],
        note: Component,
        stale: () => boolean
    ): Promise<void> {
        const heading = el.createDiv({ cls: "daily-note-mentions-heading" });
        heading.createDiv({ cls: "daily-note-mentions-title", text: "Linked mentions" });
        heading.createDiv({ cls: "daily-note-mentions-count", text: String(mentions.length) });
        const content = el.createDiv({ cls: "daily-note-mentions-content" });

        let drawn: Promise<void> | null = null;
        const draw = () => (drawn ??= this.drawMentions(el, content, mentions, note, stale));
        let collapsed = false;
        const toggle = this.collapsible.attachCollapseToggle(heading, {
            filePath: file.path,
            sectionKey: LINKED_MENTIONS_SECTION_KEY,
            defaultCollapsed: this.getSettings().linkedMentionsCollapsed,
            apply: (next) => {
                collapsed = next;
                el.toggleClass("is-collapsed", next);
                if (!next) void draw();
            },
            hides: (node) => content.contains(node),
        });
        this.collapsible.attachCollapseHost(heading, toggle);
        return collapsed ? Promise.resolve() : draw();
    }

    /** Reads every linking note at once, then draws a group for each note. */
    private async drawMentions(
        el: HTMLElement,
        content: HTMLElement,
        mentions: readonly Mention[],
        note: Component,
        stale: () => boolean
    ): Promise<void> {
        try {
            const texts = await Promise.all(
                mentions.map((mention) =>
                    // Stryker disable next-line StringLiteral: a mention with no excerpt never reads its text.
                    mention.excerpts.length > 0 ? this.app.vault.cachedRead(mention.source) : Promise.resolve("")
                )
            );
            if (stale()) return;
            await Promise.all(mentions.map((mention, i) => this.drawMention(content, mention, texts[i]!, note)));
            if (Platform.isMobile) {
                stackWideTables(content, note, this.widths);
                fitWideEquations(content, note, this.widths);
            }
            this.decorate(el);
        } catch (error) {
            console.error("DailyNotesStream: Failed to draw linked mentions", error);
        }
    }

    /**
     * The group's title links to its note. Each excerpt's links are resolved
     * from that note.
     */
    private drawMention(content: HTMLElement, mention: Mention, text: string, note: Component): Promise<unknown> {
        const { source, excerpts, properties } = mention;
        const group = content.createDiv({ cls: "daily-note-mention" });
        group.dataset.linkSource = source.path;
        group.createEl("a", {
            cls: "internal-link daily-note-mention-title",
            text: source.basename,
            href: source.path,
            attr: { "data-href": source.path },
        });
        const lines = [...properties, ...excerpts.map(({ start, end }) => text.slice(start, end))];
        return Promise.all(
            lines.map((markdown) =>
                MarkdownRenderer.render(
                    this.app,
                    markdown,
                    group.createDiv({ cls: "daily-note-mention-excerpt markdown-rendered" }),
                    source.path,
                    note
                )
            )
        );
    }
}
