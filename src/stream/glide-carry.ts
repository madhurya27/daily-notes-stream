/**
 * How much of a glide's speed it carries on with. At full speed, the stop
 * showed as a stall, then a restart.
 */
const SPEED_KEPT = 0.9;
/** iOS's normal deceleration: a glide keeps 0.998 of its speed each ms. */
const FRICTION = -Math.log(0.998);
/** Below this speed, in px/ms, a glide has ended. */
const MIN_SPEED = 0.02;
/** A frame's time, for a frame stamped before the carry started. */
const FRAME_MS = 16;
/**
 * The most time one step makes up. After a slow frame, the glide runs a little
 * late, not a long way in one frame.
 */
const LONGEST_STEP_MS = 33;
/** How far back a speed is measured: iOS's scroll events are uneven (D-176). */
const SPEED_WINDOW_MS = 100;

/** How fast a scroll has moved lately, from the steps it was heard to take. */
export class ScrollSpeed {
    private readonly steps: { at: number; travelled: number }[] = [];
    private travelled = 0;

    heard(moved: number): void {
        const at = performance.now();
        this.travelled += moved;
        this.steps.push({ at, travelled: this.travelled });
        while (this.steps[1] && this.steps[1].at <= at - SPEED_WINDOW_MS) this.steps.shift();
    }

    pxPerMs(): number {
        if (this.steps.length === 0) return 0;
        const first = this.steps[0]!;
        const last = this.steps.at(-1)!;
        const ms = last.at - first.at;
        return ms === 0 ? 0 : (last.travelled - first.travelled) / ms;
    }
}

/**
 * Carries on a glide up that iOS was stopped from finishing, with the script
 * writing the scroll each frame, which iOS leaves alone once it is not
 * scrolling (D-192). It slows as iOS would, and if that would take it past the
 * top, it slows just enough to land there.
 */
export class GlideCarry {
    private frame = 0;
    private speed = 0;
    private last = 0;
    /** What rounding to whole pixels has not written yet. */
    private unwritten = 0;

    /** `beforeStep` runs each frame, before the scroll position is read. */
    constructor(
        private readonly root: HTMLElement,
        private readonly beforeStep: () => void
    ) {}

    get carrying(): boolean {
        return this.frame !== 0;
    }

    /** Carries on up from `speed`, in px/ms. Too slow to see, it does not. */
    start(speed: number): void {
        this.cancel();
        if (speed < MIN_SPEED) return;
        this.speed = speed * SPEED_KEPT;
        this.unwritten = 0;
        this.last = performance.now();
        this.frame = window.requestAnimationFrame(this.step);
    }

    cancel(): void {
        window.cancelAnimationFrame(this.frame);
        this.frame = 0;
    }

    private readonly step = (now: number): void => {
        const ms = now > this.last ? Math.min(now - this.last, LONGEST_STEP_MS) : FRAME_MS;
        this.last = now;
        this.beforeStep();
        const left = this.root.scrollTop;
        const rate = Math.max(FRICTION, this.speed / left);
        const slower = this.speed * Math.exp(-rate * ms);
        this.unwritten += (this.speed - slower) / rate;
        this.speed = slower;
        // It nears the top ever slower as it lands, so that ends by distance.
        const landing = rate > FRICTION;
        // Stryker disable next-line EqualityOperator: exactly 1 px left, the next step lands there too.
        if (landing && left - this.unwritten < 1) return this.end(0);
        // Stryker disable next-line EqualityOperator: a speed that decays never lands exactly on the minimum.
        if (!landing && this.speed < MIN_SPEED) return this.end(left - this.unwritten);
        const whole = Math.trunc(this.unwritten);
        this.unwritten -= whole;
        this.root.scrollTop = left - whole;
        this.frame = window.requestAnimationFrame(this.step);
    };

    private end(scrollTop: number): void {
        this.frame = 0;
        this.root.scrollTop = scrollTop;
    }
}
