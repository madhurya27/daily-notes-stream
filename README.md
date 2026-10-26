# Daily Notes Stream

Read your daily notes as one continuous journal timeline. Every day appears on one page, with the newest at the top and older days loading as you scroll. The stream is for reading; to edit a note, click its date.

It works with the daily notes you already have. There's no new folder, format, or template to set up, and it never changes your notes. Scrolling stays smooth and fast, even through years of notes.

**You'll need daily notes set up already:** Obsidian's core **Daily notes** plugin, or Periodic Notes with daily notes turned on, and at least one note. The stream shows the notes in that folder whose names match its date format.

<p><img src="docs/images/demo-desktop.webp" alt="Recording on desktop: the newest note, open in a split, is edited and the stream beside it updates as the words are typed. The stream then scrolls through older days, a search steps through notes mentioning Mara, a jump goes to an older date, and the command palette scrolls it back to the top" width="800"></p>

## Features

- **One stream.** Every daily note appears on one scrolling page, newest first, including notes in nested folders such as `2025/03/2025-03-04.md`.
- **Smooth scrolling.** Scroll through years of notes on desktop or a phone without stutters, and without the page jumping as notes load. Only the notes near what you're reading are kept loaded, so it stays fast and light on memory.
- **Always current.** When you create, edit, rename, or delete a note, the stream updates right away.
- **[Search](#search).** Press Ctrl/Cmd+F to find text across every note.
- **[Jump to a date](#move-around).** Go straight to any day that has a note.
- **[Fold sections](#fold-sections).** Collapse any heading or nested list, and the stream remembers it.
- **Properties.** Each note's properties appear at its top. You can hide or collapse them in [settings](#settings).
- **[Linked mentions](#linked-mentions).** Each note ends with the notes that link to it. You can hide or collapse them in [settings](#settings).
- **[Full notes](#open-the-stream).** Each note is shown in full, the way Obsidian shows it, with its images, tables, embeds, links, tasks, and Bases. The stream is read-only, so you can't tick a task in it.
- **[Phone and tablet](#phone-and-tablet).** Tables, Bases, and Kanban Bases too wide for the screen are shown as cards, so one swipe moves the whole stream.

## Before you install

- **Which notes does it show?** The notes in the folder set in **Settings → Daily notes**, including its subfolders, whose names match the date format set there. If you use Periodic Notes with its daily notes turned on, the stream uses Periodic Notes' folder and format instead.
- **What does it store?** Your settings, saved in the plugin's folder. Which sections you folded, and layout measurements that keep scrolling steady, are kept separately on each device.
- **Is it private?** Yes. It collects no telemetry or analytics, needs no account, and never sends your notes or anything about you anywhere. The only things that load from the web are embeds you put in your notes yourself, such as videos. On a phone or tablet, a YouTube video shows as its preview image, loaded from YouTube (`i.ytimg.com`), because a YouTube embed inside the stream causes scroll issues.
- **Does it slow down with years of notes?** No. It's tested on five years of daily notes, on desktop and on iOS, and stays as fast at the end as at the start.
- **Does it need anything else installed?** No. It has no dependencies: it contains no code from other projects and uses only what Obsidian provides.
- **Which devices does it run on?** Desktop and mobile, and it's tested thoroughly on desktop and iOS. It needs Obsidian 1.14.4 or later.
- **Does it show notes the way Obsidian does?** On desktop, yes, except that a wide diagram shrinks to fit. On a phone or tablet it's opinionated: nothing inside a note scrolls on its own, so one swipe always moves the whole stream. A table, Base, or Kanban Base too wide for the screen becomes a stack of cards, a Kanban Base keeping one group per column. Only the stream's view changes, never your notes. See [Phone and tablet](#phone-and-tablet).
- **Does it work with other plugins?** Yes. Dataview tables and Bases are shown the way Obsidian shows them, reshaped on a phone or tablet as above. Templates made with the core Templates plugin or with Templater are recognized when empty notes are hidden. See [Empty notes](#empty-notes).
- **Can I edit notes in the stream?** No. It's read-only, which keeps it fast and light on memory through years of notes. To edit notes in a feed, try a plugin such as [Daily Notes Editor](https://github.com/Quorafind/Obsidian-Daily-Notes-Editor).

## Use

### Open the stream

Click the ribbon icon (a stack of cards), or run `Daily Notes Stream: Open stream` from the command palette (Ctrl/Cmd+P). It opens in the current tab. To open it in a new tab, Ctrl/Cmd-click the icon.

On a phone, tap the menu button (☰) at the right of the bottom bar, then **Open daily notes stream**. The same menu has **Open command palette**.

To find the stream waiting each time you start Obsidian, pin its tab: right-click the tab and select **Pin**. Obsidian reopens the tabs you left open, and a pinned stream stays in its tab: notes you open from it open in a new tab instead of replacing it. It reopens at the newest note.

Each note is shown in full, as it looks in Obsidian's reading view, with its properties, images, tables, embeds, links, tasks, and Bases. The stream is read-only, so clicking a task's checkbox doesn't tick it. Open the note to edit it. Some content is reshaped so the stream scrolls smoothly, mostly on a phone or tablet. See [Phone and tablet](#phone-and-tablet).

<img src="docs/images/stream-desktop.png" alt="The end of one daily note and the start of the next, its date and properties, in the stream" width="800">

### Empty notes

Every daily note is shown, including ones you never wrote in. To leave those out, turn on **Hide empty notes** in [settings](#settings). Then a daily note that holds nothing, or only the text of your daily-notes template, is left out of the stream. It appears as soon as you write in it or change one of its properties.

Some empty notes still show. Today's note always does, and so does a note that another note links to, so you can see its linked mentions. A note made from an older version of your template shows too, because it no longer matches the current one.

Templates made with the core Templates plugin or with Templater both work. A placeholder such as `{{date}}` or `<% tp.date.now() %>` can fill in anything on its own line. A Templater command that can write more than one line, such as `tp.file.include` or an `if` that picks between sections, can't be matched. A note made from a template that uses one always shows, even before you write in it.

### Move around

| To | Do |
| --- | --- |
| Load older notes | Scroll down |
| Go back to the newest | Click the arrow icon at the top, or run `Daily Notes Stream: Scroll to top`. On mobile, tap the title at the top |
| Go to a date | Click the calendar icon at the top, or run `Daily Notes Stream: Jump to date` |

The jump list opens on your 62 newest notes, about two months. Type to search the rest: a year, such as `2025`, lists every day of it that has a note. You can type a date in your daily-note format or as `YYYY-MM-DD`. If that day has no note, you go to the closest earlier day that does. The calendar button in the list opens your device's date picker.

<img src="docs/images/jump-desktop.png" alt="The jump-to-date prompt listing the vault's dates" width="800">

### Search

Press Ctrl/Cmd+F, or click the search icon at the top. If you changed Obsidian's "Search current file" shortcut, use yours.

| Key         | Action                 |
| ----------- | ---------------------- |
| Enter       | Next matching note     |
| Shift+Enter | Previous matching note |
| Escape      | Close search           |

Search looks only at each note's own text. Content that comes from other notes, such as a Base, an embedded note, or linked mentions, isn't searched. If a match is inside a folded section, search unfolds it. If the counter reads `2 / 5 · hidden`, the match is in a part of the note that isn't shown, such as hidden properties or an embed.

<img src="docs/images/search-desktop.png" alt="The search bar stepping through notes that mention Mara" width="800">

### Fold sections

Click the arrow beside a heading or nested list to fold it. The stream remembers what you folded.

<img src="docs/images/collapse-desktop.png" alt="A note with every section folded to its heading" width="800">

### Linked mentions

Each note ends with a list of the notes that link to it, quoting the lines around each link.

<img src="docs/images/mentions-desktop.png" alt="A note's linked mentions: a project note and a project log, each quoting the line that links to it" width="800">

### Open notes and links

Note dates, links inside notes, and the notes and links in linked mentions all open the way links do elsewhere in Obsidian:

| Gesture | Opens |
| --- | --- |
| Click | In the stream's tab, where Back returns to the stream, or in a new tab if the stream's tab is pinned |
| Ctrl/Cmd-click or middle-click | In a new tab |
| Ctrl/Cmd+Alt-click | Side by side, in a split |
| Right-click | The file menu |

Click a tag to search for it, or Ctrl/Cmd-click it to search in a new tab. Hold Ctrl/Cmd while hovering over a link to preview it. To preview without holding the key, open **Settings → Page preview** and turn off the switch for "Daily Notes Stream".

### Phone and tablet

On a phone or tablet, nothing inside a note scrolls on its own, so one swipe moves the whole stream. Content that would need its own scrolling is reshaped instead:

| Content | Becomes |
| --- | --- |
| Table | A card per row, each value under its column's name |
| Base | Narrower columns, or if that isn't enough, a card per note in Bases' own card view |
| Kanban Base | Cards, each column a group |
| Equation | Smaller, to fit the width |
| Code block | Long lines wrap |
| Diagram | Smaller, to fit the width (on desktop too) |
| Embedded note | Shown in full, not in a box of its own that scrolls |
| YouTube video | Its preview image; tap it to watch on YouTube |
| Embedded web page | Shown as it is; tap it to open the page in your browser |
| Any other embed that scrolls | Cut off at its edge |

On desktop, wide tables and code blocks scroll sideways in their own box, as they do in Obsidian.

<p><img src="docs/images/demo-phone.webp" alt="Recording on an iPhone: flicks glide down through older days, a search for Mara is typed and stepped through, a jump goes to an older date, and a tap on the title glides back to the newest note" width="300"></p>

<details>
<summary>Phone layout</summary>

<p><img src="docs/images/stream-phone.png" alt="The stream in Obsidian's phone layout" width="260"> <img src="docs/images/search-phone.png" alt="Search in the phone layout" width="260"> <img src="docs/images/jump-phone.png" alt="Jump to date in the phone layout" width="260"></p>

<p><img src="docs/images/collapse-phone.png" alt="Collapsed sections in the phone layout" width="260"> <img src="docs/images/mentions-phone.png" alt="Linked mentions in the phone layout" width="260"> <img src="docs/images/bases-phone.png" alt="A Base drawn as cards in the phone layout" width="260"></p>

<p><img src="docs/images/stream-dark-phone.png" alt="The stream in the dark theme, phone layout" width="260"></p>

</details>

## Settings

- **Hide empty notes** (off by default) leaves out daily notes you never wrote in. See [Empty notes](#empty-notes).
- **One card per row** (off by default) gives each card the full width of the note when a Base is too wide for a phone or tablet and is shown as cards. When it's off, Obsidian decides how many cards fit in a row, usually two on a phone. A Base you set up as cards yourself keeps its own card size.
- **Properties**
    - **Show note properties** (on by default) shows each note's properties.
    - **Collapse properties by default** (off by default) starts each note with its properties folded.
- **Linked mentions**
    - **Show linked mentions** (on by default) shows the notes that link to each note.
    - **Collapse linked mentions by default** (off by default) starts them folded.

Each collapse setting appears only while its section is shown.

The stream follows Obsidian's theme, light or dark.

<img src="docs/images/stream-dark-desktop.png" alt="The stream in Obsidian's dark theme" width="800">

## Install

1. In Obsidian, open **Settings → Community plugins** and turn off **Restricted mode** if it's on.
2. Select **Browse**, search for **Daily Notes Stream**, and select **Install**.
3. Select **Enable**.
4. Open the stream from the ribbon or the command palette. See [Open the stream](#open-the-stream).

You can also open the plugin's [page in the Obsidian plugin directory](https://community.obsidian.md/plugins/daily-notes-stream) and install it from there. This works the same on a phone or tablet.

### Install by hand

1. From the [latest release](https://github.com/madhurya27/daily-notes-stream/releases/latest), download `main.js`, `manifest.json`, and `styles.css`.
2. Put them in `<Vault>/.obsidian/plugins/daily-notes-stream/`. Create the folder if it doesn't exist. Most file browsers hide `.obsidian`.
3. Reload Obsidian.
4. Enable **Daily Notes Stream** in **Settings → Community plugins**.

On a phone or tablet, install the plugin on a computer first and let your sync service copy the plugin folder to the device. Then enable it there.

To check that the downloaded files were built from this repository, run `gh attestation verify main.js --repo madhurya27/daily-notes-stream` with the GitHub CLI, and the same for the other two files. This works for releases after 1.0.0.

To build from source instead, run `pnpm run build` and copy the same three files to the same folder.

## Troubleshooting

| You see | What to do |
| --- | --- |
| "No daily notes found" | Make sure **Daily notes** is on in **Settings → Core plugins** (or Periodic Notes, if you use it), and that the folder and date format in **Settings → Daily notes** match where your notes are and how they're named. |
| "Every daily note is hidden" | Every daily note holds only its template, so all of them are hidden. Write in one, or turn off **Hide empty notes**. |
| A note you expected is missing | Either **Hide empty notes** is on and it holds only its template (see [Empty notes](#empty-notes)), or its name doesn't match the date format. |
| After installing by hand, the plugin isn't listed under Community plugins | Make sure the three files sit directly in `daily-notes-stream/`, not in a subfolder, then reload Obsidian. |

## Support

If you find the plugin useful, please [star it on GitHub](https://github.com/madhurya27/daily-notes-stream). It's a quick way to say thanks, and it helps others find it.

## Development

```bash
pnpm install && pnpm test && pnpm run lint && pnpm run build
```

## Credits

Thank you to the authors and maintainers of the projects that inspired this plugin:

- [Logseq](https://github.com/logseq/logseq)
- [obsidian-daily-notes-interface](https://github.com/liamcain/obsidian-daily-notes-interface)
- [Daily Notes Editor](https://github.com/Quorafind/Obsidian-Daily-Notes-Editor)
- [Journal Review](https://github.com/Kageetai/obsidian-plugin-journal-review)
- [Calendar](https://github.com/liamcain/obsidian-calendar-plugin)
- [Jump to Date](https://github.com/TfTHacker/obsidian42-jump-to-date)
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview)
- [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes)
- [Templater](https://github.com/SilentVoid13/Templater)

## License

MIT
