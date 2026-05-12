import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingPillDemo } from './recording-pill-demo';

describe('RecordingPillDemo', () => {
    it('renders each labeled state when forced via initialState', () => {
        const { unmount: u1 } = render(<RecordingPillDemo initialState="recording" />);
        expect(screen.getByText('Recording')).toBeInTheDocument();
        u1();

        const { unmount: u2 } = render(<RecordingPillDemo initialState="transcribing" />);
        expect(screen.getByText('Transcribing…')).toBeInTheDocument();
        u2();

        render(<RecordingPillDemo initialState="pasted" />);
        expect(screen.getByText('Pasted')).toBeInTheDocument();
    });

    describe('auto-cycle', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('advances from recording → transcribing → pasted on its timer', () => {
            render(<RecordingPillDemo />);
            expect(screen.getByText('Recording')).toBeInTheDocument();

            // Component uses setInterval with the recording duration (2400ms)
            // as its tick — each tick advances to the next state.
            act(() => {
                vi.advanceTimersByTime(2000);
            });
            expect(screen.getByText('Transcribing…')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(2000);
            });
            expect(screen.getByText('Pasted')).toBeInTheDocument();
        });
    });
});
