import { describe, it, expect, vi } from "vitest";
import { TFile } from "../mocks/obsidian";
import { flushPromises, makeApp, makeStubbedView, makeViewSetup } from "../stream-view-fixture";
import { LinkChanges } from "../../src/notes/link-changes";

// What each event does to the stream is tested in note-stream.test.ts. This
// tests how the events are connected.
describe("DailyNotesStreamView — vault events", () => {
    /**
     * Opens a view whose vault and metadataCache keep the callbacks registered
     * with them.
     */
    async function makeWiredView() {
        const app = makeApp();
        const { view } = await makeViewSetup(app);
        const callbacks = Object.fromEntries([...app.vault.on.mock.calls, ...app.metadataCache.on.mock.calls]);
        return { view, callbacks, vault: app.vault };
    }

    it("metadataCache 'changed' callback delegates to onFileModify", async () => {
        const { view, callbacks } = await makeWiredView();
        const spy = vi.spyOn(view["stream"], "onFileModify");
        const file = new TFile("Notes/2025-01-01.md");
        callbacks["changed"]?.(file);
        expect(spy).toHaveBeenCalledWith(file);
    });

    // vault 'modify' fires before metadataCache is updated, so drawing the note
    // again then would remove the frontmatter at an old position.
    it("does not re-render a note on vault 'modify'", async () => {
        const { view, callbacks } = await makeWiredView();
        const spy = vi.spyOn(view["stream"], "onFileModify");
        callbacks["modify"]?.(new TFile("Notes/2025-01-01.md"));
        expect(spy).not.toHaveBeenCalled();
    });

    // A Base file has no metadata to wait for. Its copies drawn as cards are
    // drawn again.
    it("vault 'modify' callback hands the file to the renderer's Bases", async () => {
        const { view, callbacks } = await makeWiredView();
        const spy = vi.spyOn(view["renderer"], "onBaseModified").mockResolvedValue();
        const file = new TFile("Bases/Views.base");
        callbacks["modify"]?.(file);
        expect(spy).toHaveBeenCalledWith(file);
    });

    it("vault 'create' callback delegates to onFileCreate", async () => {
        const { view, callbacks } = await makeWiredView();
        const spy = vi.spyOn(view["stream"], "onFileCreate");
        const file = new TFile("Notes/2025-01-01.md");
        callbacks["create"]?.(file);
        expect(spy).toHaveBeenCalledWith(file);
    });

    it("vault 'delete' callback delegates to onFileDelete", async () => {
        const { view, callbacks } = await makeWiredView();
        const spy = vi.spyOn(view["stream"], "onFileDelete");
        const file = new TFile("Notes/2025-01-01.md");
        callbacks["delete"]?.(file);
        expect(spy).toHaveBeenCalledWith(file);
    });

    it("vault 'rename' callback delegates to onFileRename with the old path", async () => {
        const { view, callbacks } = await makeWiredView();
        const spy = vi.spyOn(view["stream"], "onFileRename");
        const file = new TFile("Notes/2025-01-01.md");
        callbacks["rename"]?.(file, "Notes/old-name.md");
        expect(spy).toHaveBeenCalledWith(file, "Notes/old-name.md");
    });

    describe("while the notes are still being listed", () => {
        /**
         * A view whose `initialize` waits for `listed`, and the callbacks
         * registered so far.
         */
        function openSlowly() {
            const app = makeApp();
            const { view, service } = makeStubbedView(app);
            let listed!: () => void;
            vi.mocked(service.initialize).mockReturnValue(new Promise<void>((resolve) => (listed = resolve)));
            const opened = view.onOpen();
            const callbacks = () => Object.fromEntries([...app.vault.on.mock.calls]);
            return { service, callbacks, listed, opened };
        }

        // A note synced or deleted while the stream opens. If the event was
        // missed, the stream stayed wrong until a refresh.
        it("applies a delete heard meanwhile once the stream opens", async () => {
            const { service, callbacks, listed, opened } = openSlowly();

            callbacks()["delete"]?.(new TFile("Notes/2025-01-01.md"));
            await flushPromises();
            expect(service.removeSorted).not.toHaveBeenCalled();

            listed();
            await opened;
            await flushPromises();
            expect(service.removeSorted).toHaveBeenCalledWith("Notes/2025-01-01.md");
        });

        it("applies a create heard meanwhile once the stream opens", async () => {
            const { service, callbacks, listed, opened } = openSlowly();

            const file = new TFile("Notes/2025-01-01.md");
            callbacks()["create"]?.(file);
            await flushPromises();
            expect(service.insertSorted).not.toHaveBeenCalled();

            listed();
            await opened;
            await flushPromises();
            expect(service.insertSorted).toHaveBeenCalledWith(file);
        });
    });

    // Mermaid's "Allow" fires it, and so does a plugin adding or removing a
    // post-processor.
    it("workspace 'post-processor-change' re-renders the stream", async () => {
        const app = makeApp();
        const { view } = await makeViewSetup(app);
        const spy = vi.spyOn(view["stream"], "refresh").mockResolvedValue();
        const callbacks = Object.fromEntries(app.workspace.on.mock.calls);
        callbacks["post-processor-change"]?.();
        expect(spy).toHaveBeenCalled();
    });
});

describe("DailyNotesStreamView — links to daily notes", () => {
    /**
     * A view opened with the plugin's link changes, and a way to make `source`
     * link to `targets`.
     */
    async function openLinked(existing: (path: string) => boolean = () => true) {
        const app = makeApp();
        app.vault.getFileByPath.mockImplementation((path: string) => (existing(path) ? new TFile(path) : null));
        const { view, plugin } = makeStubbedView(app);
        const links: Record<string, Record<string, number>> = {};
        plugin.linkChanges = new LinkChanges(
            () => links,
            () => "Notes"
        );
        view.load();
        await view.onOpen();
        const onLinksChanged = vi.spyOn(view["stream"], "onLinksChanged").mockResolvedValue();
        const link = (source: string, ...targets: string[]) => {
            links[source] = Object.fromEntries(targets.map((target) => [target, 1]));
            plugin.linkChanges.onResolve(source);
            plugin.linkChanges.onResolved();
        };
        return { view, onLinksChanged, link };
    }

    it("hands the stream the notes whose links changed, as files", async () => {
        const { onLinksChanged, link } = await openLinked();

        link("Meeting.md", "Notes/2025-01-01.md");

        expect(onLinksChanged.mock.calls[0]![0].map((file) => file.path)).toEqual(["Notes/2025-01-01.md"]);
    });

    it("leaves out a note no longer in the vault", async () => {
        const { onLinksChanged, link } = await openLinked((path) => path !== "Notes/2025-01-02.md");

        link("Meeting.md", "Notes/2025-01-01.md", "Notes/2025-01-02.md");

        expect(onLinksChanged.mock.calls[0]![0].map((file) => file.path)).toEqual(["Notes/2025-01-01.md"]);
    });

    it("stops listening once the view unloads", async () => {
        const { view, onLinksChanged, link } = await openLinked();

        view.unload();
        link("Meeting.md", "Notes/2025-01-01.md");

        expect(onLinksChanged).not.toHaveBeenCalled();
    });
});
