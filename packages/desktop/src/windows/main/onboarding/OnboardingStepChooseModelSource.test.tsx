import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingStepChooseModelSource } from './OnboardingStepChooseModelSource';

describe('OnboardingStepChooseModelSource', () => {
    it('renders both cloud and local options', () => {
        render(
            <OnboardingStepChooseModelSource
                onChooseCloud={vi.fn()}
                onChooseLocal={vi.fn()}
                onSkipFinish={vi.fn()}
            />,
        );
        expect(screen.getByText('Cloud provider')).toBeDefined();
        expect(screen.getByText('Local (on-device)')).toBeDefined();
        expect(screen.getByTestId('choose-cloud')).toBeDefined();
        expect(screen.getByTestId('choose-local')).toBeDefined();
    });

    it('calls onChooseCloud when cloud option clicked', async () => {
        const onChooseCloud = vi.fn();
        render(
            <OnboardingStepChooseModelSource
                onChooseCloud={onChooseCloud}
                onChooseLocal={vi.fn()}
                onSkipFinish={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByTestId('choose-cloud'));
        expect(onChooseCloud).toHaveBeenCalledOnce();
    });

    it('calls onChooseLocal when local option clicked', async () => {
        const onChooseLocal = vi.fn();
        render(
            <OnboardingStepChooseModelSource
                onChooseCloud={vi.fn()}
                onChooseLocal={onChooseLocal}
                onSkipFinish={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByTestId('choose-local'));
        expect(onChooseLocal).toHaveBeenCalledOnce();
    });
});
