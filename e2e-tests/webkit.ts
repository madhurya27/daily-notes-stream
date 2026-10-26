import { devices, webkit, type Browser, type Page } from "@playwright/test";
import { test as obsidianTest, LAYOUT_VIEWPORT } from "./obsidian";

/**
 * iOS runs the plugin in WebKit, while Obsidian on desktop is Chromium. Where
 * the two browser engines differ, in reading CSS or painting, a copy of the
 * real app's page is rendered again in WebKit (ADR 0009).
 */

/**
 * Marks the elements a copy of the page refers to, because its markup has no
 * ranges or scroll positions.
 */
const MARK = "data-webkit-node";

/**
 * One end of a range: a text node, by its parent and index, or an element and a
 * child offset.
 */
interface Point {
    el: string;
    child: number | null;
    offset: number;
    /**
     * The text node's data, checked when it arrives, because reading the markup
     * again may have moved it.
     */
    text?: string;
}

interface Snapshot {
    html: string;
    highlights: { name: string; priority: number; ranges: { start: Point; end: Point }[] }[];
    scrolls: { el: string; top: number; left: number }[];
}

/**
 * Runs in Obsidian: the page as markup, with its stylesheets inline, and what
 * markup cannot hold.
 */
async function capture(page: Page): Promise<Snapshot> {
    return page.evaluate(async (mark) => {
        let next = 0;
        const idOf = (el: Element) => {
            if (!el.hasAttribute(mark)) el.setAttribute(mark, String(next++));
            return el.getAttribute(mark)!;
        };
        const point = (node: Node, offset: number) => {
            if (!(node instanceof Text)) return { el: idOf(node as Element), child: null, offset };
            const parent = node.parentElement!;
            return { el: idOf(parent), child: [...parent.childNodes].indexOf(node), offset, text: node.data };
        };

        const highlights: Snapshot["highlights"] = [];
        CSS.highlights.forEach((highlight, name) => {
            const ranges = [...highlight].map((range) => ({
                start: point(range.startContainer, range.startOffset),
                end: point(range.endContainer, range.endOffset),
            }));
            highlights.push({ name, priority: highlight.priority, ranges });
        });
        const scrolls = [...document.querySelectorAll("*")]
            .filter((el) => el.scrollTop > 0 || el.scrollLeft > 0)
            .map((el) => ({ el: idOf(el), top: el.scrollTop, left: el.scrollLeft }));

        const clone = document.documentElement.cloneNode(true) as HTMLElement;
        for (const el of document.querySelectorAll(`[${mark}]`)) el.removeAttribute(mark);

        // As text, in place, because the app:// URLs mean nothing to another
        // browser, and the CSSOM would change -webkit- properties to Chromium's
        // names.
        const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
        const cloneLinks = [...clone.querySelectorAll('link[rel="stylesheet"]')];
        for (const [i, link] of links.entries()) {
            const style = document.createElement("style");
            if (link.sheet && !link.sheet.disabled) style.textContent = await (await fetch(link.href)).text();
            cloneLinks[i]!.replaceWith(style);
        }
        for (const script of clone.querySelectorAll("script")) script.replaceWith(document.createElement("script"));
        return { html: `<!DOCTYPE html>${clone.outerHTML}`, highlights, scrolls };
    }, MARK);
}

/** Runs in WebKit: puts back what the markup could not hold. */
async function restore(page: Page, snapshot: Snapshot): Promise<void> {
    await page.evaluate(
        ({ mark, highlights, scrolls }) => {
            const find = (id: string) => document.querySelector(`[${mark}="${id}"]`)!;
            const resolve = ({ el, child, offset, text }: Point): [Node, number] => {
                if (child === null) return [find(el), offset];
                const node = find(el).childNodes[child];
                if (!(node instanceof Text) || node.data !== text)
                    throw new Error(`Range endpoint lost in reparse: ${text}`);
                return [node, offset];
            };
            for (const { name, priority, ranges } of highlights) {
                const highlight = new Highlight();
                highlight.priority = priority;
                for (const { start, end } of ranges) {
                    const range = document.createRange();
                    range.setStart(...resolve(start));
                    range.setEnd(...resolve(end));
                    highlight.add(range);
                }
                CSS.highlights.set(name, highlight);
            }
            for (const { el, top, left } of scrolls) find(el).scrollTo(left, top);
        },
        { mark: MARK, ...snapshot }
    );
}

/**
 * An iPhone's pixel density, touch and user agent, at the size the mobile
 * project lays out Obsidian at.
 */
const { defaultBrowserType: _, ...IPHONE } = devices["iPhone 17"];

export const test = obsidianTest.extend<{ inWebKit: () => Promise<Page> }, { webkitBrowser: Browser }>({
    webkitBrowser: [
        async ({}, use) => {
            const browser = await webkit.launch();
            await use(browser);
            await browser.close();
        },
        { scope: "worker" },
    ],
    /**
     * Renders Obsidian's page as it is now, in WebKit.
     */
    inWebKit: async ({ obsidian, webkitBrowser }, use) => {
        const context = await webkitBrowser.newContext({ ...IPHONE, viewport: LAYOUT_VIEWPORT.mobile });
        await use(async () => {
            const snapshot = await capture(obsidian.page);
            const page = await context.newPage();
            await page.setContent(snapshot.html);
            await restore(page, snapshot);
            return page;
        });
        await context.close();
    },
});

export { expect } from "./obsidian";
