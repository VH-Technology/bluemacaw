/** Visual gain only: never applied to captured audio or transcription input. */
export const DEFAULT_OVERLAY_SENSITIVITY = 1;
export const MIN_OVERLAY_SENSITIVITY = 0.1;
export const MAX_OVERLAY_SENSITIVITY = 2;
export const OVERLAY_SENSITIVITY_CHANGED_EVENT = 'bluemacaw://overlay-sensitivity-changed';

export function isValidOverlaySensitivity(value: number): boolean {
    return (
        Number.isFinite(value) &&
        value >= MIN_OVERLAY_SENSITIVITY &&
        value <= MAX_OVERLAY_SENSITIVITY
    );
}
