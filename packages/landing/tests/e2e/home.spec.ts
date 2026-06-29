import { expect, test } from '@playwright/test';

test('home renders hero, providers, recording pill, footer link to privacy', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText(/your free, open source voice dictation app/i);
    await expect(page.getByText('AssemblyAI').first()).toBeVisible();
    await expect(page.getByTestId('hero-pill')).toBeVisible();
    await expect(page.locator('footer a[href="/privacy/"]')).toBeVisible();
});
