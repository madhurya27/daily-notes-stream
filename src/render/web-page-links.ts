const WEB = new Set(["http:", "https:"]);

/**
 * On mobile, a web page in a frame is shown as a preview that links to the
 * page. The frame gets no touches, because a touch would scroll the page inside
 * it instead of the stream. Null for a frame no browser could open.
 */
export function webPageLink(frame: HTMLIFrameElement, src: string): HTMLAnchorElement | null {
    const url = parse(src);
    if (!url || !WEB.has(url.protocol)) return null;

    const link = createEl("a");
    link.className = "external-link daily-note-frame-link";
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.ariaLabel = frame.getAttribute("title") || url.hostname;
    return link;
}

/**
 * A URL starting with `//` uses the page's scheme, which in the app is not http
 * or https.
 */
function parse(src: string): URL | null {
    // Stryker disable BlockStatement: an empty catch returns undefined, which the caller treats the same as null.
    try {
        return new URL(src.startsWith("//") ? `https:${src}` : src);
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
}
