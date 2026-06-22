import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPage from './page';

describe('Privacy page', () => {
    it('mentions both OS keychains', () => {
        render(<PrivacyPage />);
        expect(screen.getAllByText(/Keychain/).length).toBeGreaterThan(0);
        expect(screen.getByText(/Credential Manager/)).toBeInTheDocument();
    });

    it('declares zero telemetry', () => {
        render(<PrivacyPage />);
        expect(screen.getByText(/zero telemetry/i)).toBeInTheDocument();
    });
});
