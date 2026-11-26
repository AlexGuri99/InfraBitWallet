import { test, expect } from '@playwright/test';

test.describe('InfraBitWallet', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'InfraBitWallet' })).toBeVisible();
  });

  test('should show the wallet description', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/self-custodial/)).toBeVisible();
  });
});
