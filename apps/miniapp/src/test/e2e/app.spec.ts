import { test, expect } from '@playwright/test';

test.describe('OneZeroWallet', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');
    // App should render the title
    await expect(page.getByText('OneZeroWallet')).toBeVisible();
  });

  test('should show the wallet description', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/self-custodial/)).toBeVisible();
  });
});
