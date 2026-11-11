import { expect, test } from '@playwright/test';

test('privacy page describes credential storage for macOS and Windows', async ({ page }) => {
    await page.goto('/privacy/');
    await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
    const credentialStores = page.getByRole('main').getByRole('listitem');
    await expect(credentialStores.filter({ hasText: 'macOS:' })).toContainText('Keychain Services');
    await expect(credentialStores.filter({ hasText: 'Windows:' })).toContainText(
        'Credential Manager / DPAPI',
    );
});
