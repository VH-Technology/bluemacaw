import type { HostOs } from './invoke';

/**
 * Where the recording chip goes, as pure geometry.
 *
 * A saved placement is "this monitor, this offset inside it" rather than a
 * global x/y. A global coordinate stops meaning anything the moment the
 * display layout changes — which with a DisplayLink dock happens on every
 * login and wake — while a monitor plus an offset can be re-resolved against
 * whatever layout exists when the chip is next shown.
 */

/** Overlay window size in logical pixels. Mirrors `tauri.conf.json`. */
export const OVERLAY_WIDTH = 280;
export const OVERLAY_HEIGHT = 64;
/** Gap between the window and the bottom edge of the monitor, logical pixels. */
export const OVERLAY_BOTTOM_MARGIN = 80;

/** The fields of Tauri's `Monitor` that placement depends on. */
export interface MonitorInfo {
    name: string | null;
    position: { x: number; y: number };
    size: { width: number; height: number };
    scaleFactor: number;
}

/**
 * How the host addresses a window position across monitors.
 *
 * - `logical`: one global space in points (macOS). tao reports a monitor's
 *   position and size multiplied by that monitor's own scale factor, and a
 *   window's position multiplied by the scale factor of the screen it is on,
 *   so its "physical" values are not one consistent space when monitors
 *   differ in scale. Dividing each value by its own scale factor recovers
 *   the real global points.
 * - `physical`: one global space in physical pixels (Windows, Linux).
 */
export type CoordinateSpace = 'logical' | 'physical';

export function coordinateSpaceFor(os: HostOs): CoordinateSpace {
    return os === 'macos' ? 'logical' : 'physical';
}

export interface OverlayPlacement {
    monitorName: string | null;
    /**
     * The monitor's origin and size in logical pixels when the placement was
     * saved. Only used to tell apart monitors that share a name (two of the
     * same model).
     */
    monitorX: number;
    monitorY: number;
    monitorWidth: number;
    monitorHeight: number;
    /** Window top-left relative to the monitor's top-left, logical pixels. */
    offsetX: number;
    offsetY: number;
}

/** A window position to hand to `setPosition`, tagged with its unit. */
export interface OverlayTarget {
    space: CoordinateSpace;
    x: number;
    y: number;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

function logicalRect(m: MonitorInfo): Rect {
    return {
        x: m.position.x / m.scaleFactor,
        y: m.position.y / m.scaleFactor,
        width: m.size.width / m.scaleFactor,
        height: m.size.height / m.scaleFactor,
    };
}

/** The monitor's rect in the unit windows are addressed in for `space`. */
function rectIn(m: MonitorInfo, space: CoordinateSpace): Rect {
    if (space === 'logical') return logicalRect(m);
    return { x: m.position.x, y: m.position.y, width: m.size.width, height: m.size.height };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

function findSavedMonitor(saved: OverlayPlacement, monitors: MonitorInfo[]): MonitorInfo | null {
    const sameName = monitors.filter((m) => m.name === saved.monitorName);
    if (sameName.length <= 1) return sameName[0] ?? null;
    const distance = (m: MonitorInfo) => {
        const r = logicalRect(m);
        return (
            Math.abs(r.x - saved.monitorX) +
            Math.abs(r.y - saved.monitorY) +
            Math.abs(r.width - saved.monitorWidth) +
            Math.abs(r.height - saved.monitorHeight)
        );
    };
    return sameName.reduce((best, m) => (distance(m) < distance(best) ? m : best));
}

function toTarget(
    monitor: MonitorInfo,
    offsetX: number,
    offsetY: number,
    space: CoordinateSpace,
): OverlayTarget {
    const origin = rectIn(monitor, space);
    const unit = space === 'logical' ? 1 : monitor.scaleFactor;
    return {
        space,
        x: Math.round(origin.x + offsetX * unit),
        y: Math.round(origin.y + offsetY * unit),
    };
}

/**
 * Decide where the chip should be shown for the current display layout.
 *
 * With a saved placement whose monitor is connected, that is the saved
 * offset on that monitor (pulled inside its bounds if the monitor is
 * currently smaller than when saved). Otherwise it is the bottom-center of
 * the primary monitor. The fallback is never something to persist: the saved
 * monitor may simply be late to attach.
 */
export function resolveOverlayTarget(input: {
    saved: OverlayPlacement | null;
    monitors: MonitorInfo[];
    primary: MonitorInfo | null;
    space: CoordinateSpace;
}): OverlayTarget | null {
    const { saved, monitors, primary, space } = input;

    const savedMonitor = saved ? findSavedMonitor(saved, monitors) : null;
    if (saved && savedMonitor) {
        const r = logicalRect(savedMonitor);
        return toTarget(
            savedMonitor,
            clamp(saved.offsetX, 0, r.width - OVERLAY_WIDTH),
            clamp(saved.offsetY, 0, r.height - OVERLAY_HEIGHT),
            space,
        );
    }

    const fallback = primary ?? monitors[0];
    if (!fallback) return null;
    const r = logicalRect(fallback);
    return toTarget(
        fallback,
        (r.width - OVERLAY_WIDTH) / 2,
        r.height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_MARGIN,
        space,
    );
}

function distanceToRect(px: number, py: number, r: Rect): number {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.width));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.height));
    return Math.hypot(dx, dy);
}

function placementOn(monitor: MonitorInfo, offsetX: number, offsetY: number): OverlayPlacement {
    const r = logicalRect(monitor);
    return {
        monitorName: monitor.name,
        monitorX: r.x,
        monitorY: r.y,
        monitorWidth: r.width,
        monitorHeight: r.height,
        offsetX: Math.round(offsetX),
        offsetY: Math.round(offsetY),
    };
}

/**
 * Turn the window's current position (as tao reports it) into a placement:
 * the monitor under the chip's center, or the nearest one, and the offset
 * inside it.
 */
export function placementFromWindow(input: {
    position: { x: number; y: number };
    windowScaleFactor: number;
    monitors: MonitorInfo[];
    space: CoordinateSpace;
}): OverlayPlacement | null {
    const { position, windowScaleFactor, monitors, space } = input;
    const first = monitors[0];
    if (!first) return null;

    // Window top-left and size in the unit windows are addressed in.
    const windowUnit = space === 'logical' ? 1 / windowScaleFactor : 1;
    const sizeUnit = space === 'logical' ? 1 : windowScaleFactor;
    const x = position.x * windowUnit;
    const y = position.y * windowUnit;
    const centerX = x + (OVERLAY_WIDTH * sizeUnit) / 2;
    const centerY = y + (OVERLAY_HEIGHT * sizeUnit) / 2;

    const monitor = monitors.reduce((best, m) =>
        distanceToRect(centerX, centerY, rectIn(m, space)) <
        distanceToRect(centerX, centerY, rectIn(best, space))
            ? m
            : best,
    );
    const origin = rectIn(monitor, space);
    const perLogical = space === 'logical' ? 1 : monitor.scaleFactor;
    return placementOn(monitor, (x - origin.x) / perLogical, (y - origin.y) / perLogical);
}

/**
 * Interpret a position saved by an older build — a bare global x/y in tao's
 * physical pixels — as a placement on whichever connected monitor contains
 * it. Returns null when none does, so the caller falls back to the default.
 */
export function placementFromLegacyPosition(
    legacy: { x: number; y: number },
    monitors: MonitorInfo[],
): OverlayPlacement | null {
    const monitor = monitors.find((m) => {
        const r = rectIn(m, 'physical');
        return (
            legacy.x >= r.x &&
            legacy.y >= r.y &&
            legacy.x < r.x + r.width &&
            legacy.y < r.y + r.height
        );
    });
    if (!monitor) return null;
    return placementOn(
        monitor,
        (legacy.x - monitor.position.x) / monitor.scaleFactor,
        (legacy.y - monitor.position.y) / monitor.scaleFactor,
    );
}
