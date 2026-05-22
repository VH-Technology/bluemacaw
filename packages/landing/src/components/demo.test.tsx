import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Demo } from './demo';

// All assertions use the `initialPhase` test seam so the auto-cycle timers
// never run — each phase renders deterministically.
describe('Demo', () => {
    it('exposes an accessible recording-demo region', () => {
        render(<Demo initialPhase="idle" />);
        expect(screen.getByRole('region', { name: /recording demo/i })).toBeInTheDocument();
    });

    it('idle shows the dictate prompt + shortcut keys (Space is OS-agnostic)', () => {
        render(<Demo initialPhase="idle" />);
        expect(screen.getByText(/press to dictate/i)).toBeInTheDocument();
        // Both macOS (⌘⇧Space) and Windows/Linux (Ctrl+⇧Space) end in Space.
        expect(screen.getByText('Space')).toBeInTheDocument();
        expect(screen.getByTestId('demo-pill')).toHaveAttribute('data-state', 'idle');
    });

    it('recording shows the Recording pill + waveform', () => {
        render(<Demo initialPhase="recording" />);
        expect(screen.getByText('Recording')).toBeInTheDocument();
        expect(screen.getByTestId('demo-waveform')).toBeInTheDocument();
        expect(screen.getByTestId('demo-pill')).toHaveAttribute('data-state', 'recording');
    });

    it('transcribing shows the Transcribing pill', () => {
        render(<Demo initialPhase="transcribing" />);
        expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
        expect(screen.getByTestId('demo-pill')).toHaveAttribute('data-state', 'transcribing');
    });

    it('done shows the full transcript + Pasted pill', () => {
        render(<Demo initialPhase="done" />);
        expect(screen.getByText('Pasted')).toBeInTheDocument();
        expect(screen.getByTestId('demo-pill')).toHaveAttribute('data-state', 'pasted');
        expect(screen.getByText(/schedule a follow-up with the design team/i)).toBeInTheDocument();
    });
});
