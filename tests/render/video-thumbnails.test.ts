import { describe, it, expect, vi } from "vitest";
import { fallBackToSmallThumbnail, youtubeThumbnail } from "../../src/render/video-thumbnails";

const ID = "aqz-KE-bpKQ";

function frame(size: { width?: string; height?: string; title?: string } = {}): HTMLIFrameElement {
    const el = document.createElement("iframe");
    for (const [name, value] of Object.entries(size)) el.setAttribute(name, value);
    return el;
}

function thumbnail(src: string, size?: Parameters<typeof frame>[0]): HTMLAnchorElement {
    const el = youtubeThumbnail(frame(size), src);
    if (!(el instanceof HTMLAnchorElement)) throw new Error(`no thumbnail for ${src}`);
    return el;
}

describe("youtubeThumbnail", () => {
    it.each([
        `https://www.youtube.com/embed/${ID}`,
        `https://youtube.com/embed/${ID}`,
        `https://www.youtube-nocookie.com/embed/${ID}`,
        `//www.youtube.com/embed/${ID}`,
    ])("links %s to the video on YouTube", (src) => {
        expect(thumbnail(src).href).toBe(`https://www.youtube.com/watch?v=${ID}`);
    });

    it("opens the video where the embed starts it", () => {
        expect(thumbnail(`https://www.youtube.com/embed/${ID}?start=90&autoplay=1`).href).toBe(
            `https://www.youtube.com/watch?v=${ID}&t=90`
        );
    });

    // Obsidian opens an external link in the browser, or the YouTube app.
    it("is an external link", () => {
        const link = thumbnail(`https://www.youtube.com/embed/${ID}`);

        expect(link.classList.contains("external-link")).toBe(true);
        expect(link.target).toBe("_blank");
        expect(link.rel).toBe("noopener");
    });

    // Sharp across a phone at 3x: 1,280 px wide, while hqdefault is 480.
    it("shows the video's largest thumbnail under a play button", () => {
        const link = thumbnail(`https://www.youtube.com/embed/${ID}`);

        expect(link.querySelector("img")?.getAttribute("src")).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
        expect(link.querySelector("img")?.alt).toBe("");
        expect(link.querySelector(".daily-note-video-play")).not.toBeNull();
    });

    // YouTube's own button: red with a white triangle, hidden from screen
    // readers because the link already names the video.
    it("draws YouTube's play button", () => {
        const play = thumbnail(`https://www.youtube.com/embed/${ID}`).querySelector(".daily-note-video-play")!;
        const [button, triangle] = Array.from(play.children);

        expect(play.getAttribute("viewBox")).toBe("0 0 68 48");
        expect(play.getAttribute("aria-hidden")).toBe("true");
        expect(button!.getAttribute("fill")).toBe("#f00");
        expect(triangle!.getAttribute("d")).toBe("M45 24 27 14v20z");
        expect(triangle!.getAttribute("fill")).toBe("#fff");
    });

    it("is named by the embed's title, or as a YouTube video", () => {
        expect(thumbnail(`https://www.youtube.com/embed/${ID}`, { title: "Big Buck Bunny" }).ariaLabel).toBe(
            "Big Buck Bunny"
        );
        expect(thumbnail(`https://www.youtube.com/embed/${ID}`).ariaLabel).toBe("YouTube video");
    });

    // The player's size, so the note is as tall as it would have been.
    it("takes the embed's width and shape", () => {
        const link = thumbnail(`https://www.youtube.com/embed/${ID}`, { width: "560", height: "315" });

        expect(link.style.getPropertyValue("--daily-note-video-width")).toBe("560px");
        expect(link.style.getPropertyValue("--daily-note-video-ratio")).toBe("560 / 315");
    });

    // The stylesheet's defaults: 16:9, as wide as the note.
    it("sets no size when the embed gives none", () => {
        const link = thumbnail(`https://www.youtube.com/embed/${ID}`);

        expect(link.style.getPropertyValue("--daily-note-video-width")).toBe("");
        expect(link.style.getPropertyValue("--daily-note-video-ratio")).toBe("");
    });

    it.each([{ width: "560" }, { width: "0", height: "315" }, { width: "560", height: "0" }])(
        "sets no size when the embed gives only part of one: %o",
        (size) => {
            const link = thumbnail(`https://www.youtube.com/embed/${ID}`, size);

            expect(link.style.getPropertyValue("--daily-note-video-width")).toBe("");
        }
    );

    it.each([
        "https://player.vimeo.com/video/76979871",
        "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        "https://www.youtube.com/embed/",
        "https://www.youtube.com/embed/videoseries?list=PL123",
        "https://evil.example/www.youtube.com/embed/aqz-KE-bpKQ",
        "/embed/aqz-KE-bpKQ",
        "not a url at all",
    ])("leaves %s a frame", (src) => {
        expect(youtubeThumbnail(frame(), src)).toBeNull();
    });
});

describe("fallBackToSmallThumbnail", () => {
    const MAX = `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`;
    const HQ = `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`;
    const image = () => thumbnail(`https://www.youtube.com/embed/${ID}`).querySelector("img")!;
    /** As the stream's capture listener passes it on. */
    const event = (type: "load" | "error", target: EventTarget) => ({ type, target }) as unknown as Event;
    const loaded = (img: HTMLImageElement, width: number) => {
        Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
        fallBackToSmallThumbnail(event("load", img));
    };

    it("falls back to the one every video has when the large one fails", () => {
        const img = image();

        fallBackToSmallThumbnail(event("error", img));

        expect(img.getAttribute("src")).toBe(HQ);
    });

    // When one is missing, YouTube sends a 120 px grey placeholder.
    it("falls back when YouTube sends its stand-in", () => {
        const img = image();

        loaded(img, 120);

        expect(img.getAttribute("src")).toBe(HQ);
    });

    it("keeps a large thumbnail that loads", () => {
        const img = image();

        loaded(img, 1280);

        expect(img.getAttribute("src")).toBe(MAX);
    });

    // Setting the same src again would load it again, and fail again.
    it("falls back once, not again when the fallback fails", () => {
        const img = image();
        fallBackToSmallThumbnail(event("error", img));
        const set = vi.spyOn(HTMLImageElement.prototype, "src", "set");

        fallBackToSmallThumbnail(event("error", img));
        loaded(img, 120);

        expect(set).not.toHaveBeenCalled();
        set.mockRestore();
        expect(img.getAttribute("src")).toBe(HQ);
    });

    it("leaves any other image alone", () => {
        const other = document.createElement("img");
        other.src = MAX;

        fallBackToSmallThumbnail(event("error", other));
        fallBackToSmallThumbnail(event("error", document.createElement("div")));

        expect(other.getAttribute("src")).toBe(MAX);
    });
});
