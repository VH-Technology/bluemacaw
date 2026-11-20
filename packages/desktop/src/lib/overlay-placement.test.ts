import { describe, expect, it } from 'vitest';
import {
    type MonitorInfo,
    type OverlayPlacement,
    coordinateSpaceFor,
    placementFromLegacyPosition,
    placementFromWindow,
    resolveOverlayTarget,
} from './overlay-placement';

// A real two-external-monitor desk (laptop lid closed): an ultrawide as the
// main display and a DisplayLink-driven QHD panel to its right, 217 pt higher.
const ULTRAWIDE: MonitorInfo = {
    name: 'Monitor #45574',
    position: { x: 0, y: 0 },
    size: { width: 3440, height: 1440 },
    scaleFactor: 1,
};
const QHD: MonitorInfo = {
    name: 'Monitor #23698',
    position: { x: 3440, y: -217 },
    size: { width: 2560, height: 1440 },
    scaleFactor: 1,
};
// What the same DisplayLink panel reports for the first seconds after login,
// before DisplayLink Manager switches it to its real mode.
const QHD_PLACEHOLDER: MonitorInfo = { ...QHD, size: { width: 1080, height: 1920 } };

// A Retina laptop panel: 1512x982 pt at 2x. tao reports size and position
// multiplied by the monitor's own scale factor.
const RETINA: MonitorInfo = {
    name: 'Monitor #41049',
    position: { x: 0, y: 0 },
    size: { width: 3024, height: 1964 },
    scaleFactor: 2,
};
// A 1x external sitting to the right of the Retina panel (origin 1512 pt).
const EXTERNAL_RIGHT_OF_RETINA: MonitorInfo = {
    name: 'Monitor #23698',
    position: { x: 1512, y: 0 },
    size: { width: 2560, height: 1440 },
    scaleFactor: 1,
};

function savedOn(monitor: MonitorInfo, offsetX: number, offsetY: number): OverlayPlacement {
    return {
        monitorName: monitor.name,
        monitorX: monitor.position.x / monitor.scaleFactor,
        monitorY: monitor.position.y / monitor.scaleFactor,
        monitorWidth: monitor.size.width / monitor.scaleFactor,
        monitorHeight: monitor.size.height / monitor.scaleFactor,
        offsetX,
        offsetY,
    };
}

describe('coordinateSpaceFor', () => {
    it('addresses macOS windows in logical points and other hosts in physical pixels', () => {
        expect(coordinateSpaceFor('macos')).toBe('logical');
        expect(coordinateSpaceFor('windows')).toBe('physical');
        expect(coordinateSpaceFor('linux')).toBe('physical');
    });
});

describe('resolveOverlayTarget — default placement', () => {
    it('centers the chip at the bottom of the primary monitor', () => {
        const target = resolveOverlayTarget({
            saved: null,
            monitors: [QHD, ULTRAWIDE],
            primary: ULTRAWIDE,
            space: 'logical',
        });
        expect(target).toEqual({ space: 'logical', x: 1580, y: 1296 });
    });

    it('offsets by the primary monitor origin instead of assuming it sits at 0,0', () => {
        const target = resolveOverlayTarget({
            saved: null,
            monitors: [ULTRAWIDE, QHD],
            primary: QHD,
            space: 'logical',
        });
        expect(target).toEqual({ space: 'logical', x: 3440 + 1140, y: -217 + 1296 });
    });

    it('measures a Retina monitor in points, not backing pixels', () => {
        const target = resolveOverlayTarget({
            saved: null,
            monitors: [RETINA],
            primary: RETINA,
            space: 'logical',
        });
        expect(target).toEqual({ space: 'logical', x: 616, y: 838 });
    });

    it('scales the offset by the monitor scale factor in a physical space', () => {
        const scaled: MonitorInfo = {
            name: '\\\\.\\DISPLAY2',
            position: { x: 1920, y: 0 },
            size: { width: 2880, height: 1620 },
            scaleFactor: 1.5,
        };
        const target = resolveOverlayTarget({
            saved: null,
            monitors: [scaled],
            primary: scaled,
            space: 'physical',
        });
        expect(target).toEqual({ space: 'physical', x: 1920 + 1230, y: 1404 });
    });

    it('falls back to the first monitor when the primary is unknown', () => {
        const target = resolveOverlayTarget({
            saved: null,
            monitors: [ULTRAWIDE, QHD],
            primary: null,
            space: 'logical',
        });
        expect(target).toEqual({ space: 'logical', x: 1580, y: 1296 });
    });

    it('returns null when no monitor is connected', () => {
        expect(
            resolveOverlayTarget({ saved: null, monitors: [], primary: null, space: 'logical' }),
        ).toBeNull();
    });
});

describe('resolveOverlayTarget — saved placement', () => {
    it('restores the exact offset on the monitor the chip was dropped on', () => {
        const target = resolveOverlayTarget({
            saved: savedOn(QHD, 1700, 90),
            monitors: [ULTRAWIDE, QHD],
            primary: ULTRAWIDE,
            space: 'logical',
        });
        expect(target).toEqual({ space: 'logical', x: 3440 + 1700, y: -217 + 90 });
    });

    it('follows the monitor when the display arrangement changes', () => {
        const moved: MonitorInfo = { ...QHD, position: { x: -2560, y: 0 } };
        const target = resolveOverlayTarget({
            saved: savedOn(QHD, 1700, 90),
            monitors: [ULTRAWIDE, moved],
            primary: ULTRAWIDE,
            space: 'logical',
        });
        expect(target).toEqual({ space: 'logical', x: -2560 + 1700, y: 90 });
    });

    it('uses the primary-monitor default while the saved monitor is disconnected', () => {
        const target = resolveOverlayTarget({
            saved: savedOn(QHD, 1700, 90),
            monitors: [ULTRAWIDE],
            primary: ULTRAWIDE,
            space: 'logical',
        });
        expect(target).toEqual({ space: 'logical', x: 1580, y: 1296 });
    });

    it('keeps the chip on screen while the saved monitor reports a smaller mode', () => {
        const target = resolveOverlayTarget({
            saved: savedOn(QHD, 1700, 90),
            monitors: [ULTRAWIDE, QHD_PLACEHOLDER],
            primary: ULTRAWIDE,
            space: 'logical',
        });
        // 1080 pt wide placeholder: the 280 pt window can start at 800 at most.
        expect(target).toEqual({ space: 'logical', x: 3440 + 800, y: -217 + 90 });
    });

    it('tells two identical monitors apart by where they were when saved', () => {
        const left: MonitorInfo = { ...QHD, position: { x: 0, y: 0 } };
        const right: MonitorInfo = { ...QHD, position: { x: 2560, y: 0 } };
        const target = resolveOverlayTarget({
            saved: savedOn(right, 100, 200),
            monitors: [left, right],
            primary: left,
            space: 'logical',
        });
        expect(target).toEqual({ space: 'logical', x: 2660, y: 200 });
    });
});

describe('placementFromWindow', () => {
    it('records the monitor under the chip and the offset inside it', () => {
        const placement = placementFromWindow({
            position: { x: 3440 + 1700, y: -217 + 90 },
            windowScaleFactor: 1,
            monitors: [ULTRAWIDE, QHD],
            space: 'logical',
        });
        expect(placement).toEqual(savedOn(QHD, 1700, 90));
    });

    it('converts a Retina window position from backing pixels to points', () => {
        // Window at 616,838 pt on the 2x panel is reported by tao as 1232,1676.
        const placement = placementFromWindow({
            position: { x: 1232, y: 1676 },
            windowScaleFactor: 2,
            monitors: [RETINA, EXTERNAL_RIGHT_OF_RETINA],
            space: 'logical',
        });
        expect(placement).toEqual(savedOn(RETINA, 616, 838));
    });

    it('does not mistake a 1x external for the Retina panel next to it', () => {
        // 1612,100 falls inside the Retina panel's *pixel* rect (3024 wide)
        // but the window is really 100 pt into the external monitor.
        const placement = placementFromWindow({
            position: { x: 1612, y: 100 },
            windowScaleFactor: 1,
            monitors: [RETINA, EXTERNAL_RIGHT_OF_RETINA],
            space: 'logical',
        });
        expect(placement).toEqual(savedOn(EXTERNAL_RIGHT_OF_RETINA, 100, 100));
    });

    it('measures the offset in logical pixels in a physical space', () => {
        const scaled: MonitorInfo = {
            name: '\\\\.\\DISPLAY2',
            position: { x: 1920, y: 0 },
            size: { width: 2880, height: 1620 },
            scaleFactor: 1.5,
        };
        const placement = placementFromWindow({
            position: { x: 1920 + 300, y: 150 },
            windowScaleFactor: 1.5,
            monitors: [scaled],
            space: 'physical',
        });
        expect(placement).toMatchObject({ monitorName: scaled.name, offsetX: 200, offsetY: 100 });
    });

    it('round-trips through resolveOverlayTarget to the same position', () => {
        const monitors = [RETINA, EXTERNAL_RIGHT_OF_RETINA];
        const placement = placementFromWindow({
            position: { x: 1612, y: 100 },
            windowScaleFactor: 1,
            monitors,
            space: 'logical',
        });
        expect(
            resolveOverlayTarget({ saved: placement, monitors, primary: RETINA, space: 'logical' }),
        ).toEqual({ space: 'logical', x: 1612, y: 100 });
    });

    it('returns null when no monitor is connected', () => {
        expect(
            placementFromWindow({
                position: { x: 0, y: 0 },
                windowScaleFactor: 1,
                monitors: [],
                space: 'logical',
            }),
        ).toBeNull();
    });
});

describe('placementFromLegacyPosition', () => {
    it('maps an old global x/y onto the monitor that contains it', () => {
        expect(placementFromLegacyPosition({ x: 1696, y: 1332 }, [ULTRAWIDE, QHD])).toEqual(
            savedOn(ULTRAWIDE, 1696, 1332),
        );
    });

    it('returns null when the old position is on no connected monitor', () => {
        expect(placementFromLegacyPosition({ x: 9000, y: 100 }, [ULTRAWIDE, QHD])).toBeNull();
    });
});
