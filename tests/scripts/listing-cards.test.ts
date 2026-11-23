import { describe, it, expect } from "vitest";
import { cardTextHtml, cardWebpArgs, DESKTOP_CARDS, PHONE_CARDS } from "../../scripts/listing-cards.mjs";

describe("cardTextHtml", () => {
    it("colours the words between asterisks", () => {
        expect(cardTextHtml("Your journal, as *one long page*.")).toBe("Your journal, as <em>one long page</em>.");
    });

    it("marks a newline as a break only the narrow cards take", () => {
        expect(cardTextHtml("Your journal,\nas a page.")).toBe('Your journal,<br class="narrow"> as a page.');
    });

    it("escapes the text around them", () => {
        expect(cardTextHtml("Bases & <Dataview>")).toBe("Bases &amp; &lt;Dataview&gt;");
    });
});

describe("the cards' phone screenshots", () => {
    // The names e2e-tests/ios/screenshots.spec.ts saves them under.
    const phoneShots = (cards: typeof PHONE_CARDS) =>
        cards.flatMap((card) => card.shots).filter((shot) => shot.endsWith("-phone.png"));

    it("are the iPhone's, the dark one included", () => {
        expect(phoneShots(PHONE_CARDS)).toEqual([
            "stream-phone.png",
            "search-phone.png",
            "jump-phone.png",
            "bases-phone.png",
            "stream-dark-phone.png",
        ]);
    });

    it("pair the light and dark stream on desktop", () => {
        expect(phoneShots(DESKTOP_CARDS)).toEqual(["stream-phone.png", "stream-dark-phone.png"]);
    });
});

describe("cardWebpArgs", () => {
    it("encodes a card lossless, at the smallest size cwebp finds", () => {
        expect(cardWebpArgs("raw/phone-5-dark.png", "cards/phone/5-dark.webp")).toEqual([
            ...["-quiet", "-lossless", "-z", "9"],
            ...["raw/phone-5-dark.png", "-o", "cards/phone/5-dark.webp"],
        ]);
    });
});
