/**
 * The Obsidian app object the page puts on window. Its type is loose on
 * purpose.
 */
declare global {
    interface Window {
        app: any;
        /** The moment.js that Obsidian includes and makes available. */
        moment: any;
        /** Obsidian's Electron bridge. The tests hide the window through it. */
        electron: any;
        /**
         * The stream's place as history.spec reads it, defined by its
         * `measurePlaces`.
         */
        streamPlace?: () => string | undefined;
        /**
         * Each place the stream shows, frame by frame, until it stops changing
         * or until `deadline`. Also defined by `measurePlaces`.
         */
        streamPlaces?: (deadline: number) => Promise<string[]>;
    }
}
export {};
