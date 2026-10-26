import { moment as obsidianMoment } from "obsidian";

/**
 * The part of moment the plugin uses. Obsidian's types get moment's types
 * through Obsidian's own dependency, which the directory scorecard's lint
 * cannot find (D-152). A test checks that the real moment matches this type. To
 * pass one moment to another, pass its milliseconds, which moment accepts just
 * as well.
 */
export interface Moment {
    add(amount: number, unit: "day"): Moment;
    clone(): Moment;
    diff(other: number): number;
    format(pattern?: string): string;
    isSame(other: number, unit: "day"): boolean;
    isValid(): boolean;
    startOf(unit: "day"): Moment;
    valueOf(): number;
}

export interface MomentFactory {
    (): Moment;
    (text: string, format: string, strict: boolean): Moment;
}

export const moment = obsidianMoment as unknown as MomentFactory;
