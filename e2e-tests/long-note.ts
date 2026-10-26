/** A long journal: headings, text, lists, tasks, code and a table, repeated. */
export function longNote(lines: number): string {
    const chunk = [
        "## Entry",
        "",
        "Woke early, walked to the [[Notes|river]] and back. The light was flat and grey, the kind that makes everything look closer than it is.",
        "",
        "- coffee with **Sam**, talked about the move",
        "- read two chapters of _The Rings of Saturn_",
        "    - the bit about the herring",
        "- [ ] call the landlord",
        "- [x] pay the gas bill",
        "",
        "```js",
        "const total = items.reduce((sum, item) => sum + item.price, 0);",
        "```",
        "",
        "| Meal | What |",
        "| --- | --- |",
        "| Lunch | soup |",
        "",
        "> Some days are just for getting through. #mood/tired",
        "",
    ];
    return Array.from({ length: Math.ceil(lines / chunk.length) }, () => chunk)
        .flat()
        .slice(0, lines)
        .join("\n");
}
