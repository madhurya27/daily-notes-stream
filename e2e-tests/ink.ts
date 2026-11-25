import type { Page } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };

/**
 * The left edge of the first text, bullet or number drawn in `box`, or the
 * box's right edge if there is none. Fold arrows are hidden. Ink is whatever
 * changes when list items are made clear, so it is found in a light theme or a
 * dark one.
 */
export async function inkLeft(page: Page, box: Box): Promise<number> {
    const hide = await page.addStyleTag({ content: ".collapse-indicator { visibility: hidden !important; }" });
    const drawn = await page.screenshot({ clip: box });
    const clear = await page.addStyleTag({
        content: ".daily-note-content li, .daily-note-content li::marker { color: transparent !important; }",
    });
    const background = await page.screenshot({ clip: box });
    await clear.evaluate((el) => (el as Element).remove());
    await hide.evaluate((el) => (el as Element).remove());

    const column = await page.evaluate(
        async ({ sources, width }) => {
            const [ink, plain] = await Promise.all(
                sources.map(async (src) => {
                    const img = new Image();
                    img.src = `data:image/png;base64,${src}`;
                    await img.decode();
                    const canvas = document.createElement("canvas");
                    [canvas.width, canvas.height] = [img.width, img.height];
                    const context = canvas.getContext("2d")!;
                    context.drawImage(img, 0, 0);
                    return context.getImageData(0, 0, img.width, img.height);
                })
            );
            for (let x = 0; x < ink!.width; x++)
                for (let y = 0; y < ink!.height; y++) {
                    const i = (y * ink!.width + x) * 4;
                    let difference = 0;
                    for (let c = 0; c < 3; c++) difference += Math.abs(ink!.data[i + c]! - plain!.data[i + c]!);
                    // Anti-aliased edges differ a little; ink differs a lot.
                    if (difference > 60) return (x * width) / ink!.width;
                }
            return width;
        },
        { sources: [drawn.toString("base64"), background.toString("base64")], width: box.width }
    );
    return box.x + column;
}
