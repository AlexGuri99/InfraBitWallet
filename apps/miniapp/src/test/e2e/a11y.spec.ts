/**
 * Stage C accessibility checks (no axe dependency: axe-core is MPL-2.0, which the dependency
 * policy asks us to review first). These checks assert the properties axe would flag most often:
 * accessible names for controls, a single h1, labelled inputs and a language on the document.
 */
import { test, expect } from '@playwright/test';

test.describe('accessibility', () => {
  test('document language and one main heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
  });

  test('every interactive control has an accessible name', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    const unnamed = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'),
      );
      const named = (el: HTMLElement): boolean => {
        if (el.getAttribute('aria-label')?.trim()) return true;
        if (el.getAttribute('aria-labelledby')) return true;
        if ((el as HTMLInputElement).id) {
          const label = document.querySelector(`label[for="${(el as HTMLInputElement).id}"]`);
          if (label?.textContent?.trim()) return true;
        }
        if (el.closest('label')?.textContent?.trim()) return true;
        if ((el.textContent ?? '').trim()) return true;
        if (el.getAttribute('title')?.trim()) return true;
        return false;
      };
      return controls
        .filter((el) => !named(el) && el.offsetParent !== null)
        .map((el) => el.outerHTML.slice(0, 80));
    });
    expect(unnamed).toEqual([]);
  });

  test('form errors are announced and inputs are labelled', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await expect(page.getByLabel('Passcode', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirm passcode')).toBeVisible();
    await page.getByLabel('Passcode', { exact: true }).fill('short');
    await page.getByLabel('Confirm passcode').fill('short');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});
