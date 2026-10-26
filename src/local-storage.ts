/**
 * A save function for one store. localStorage holds only a few megabytes,
 * shared by every vault in the app, so a save can be refused. The first refusal
 * is logged; every save after it is refused too.
 */
export function saveLoggingOnce(what: string): (save: () => void) => void {
    let failed = false;
    return (save) => {
        try {
            save();
        } catch (error) {
            if (!failed) console.error(`DailyNotesStream: Failed to save ${what}`, error);
            failed = true;
        }
    };
}
