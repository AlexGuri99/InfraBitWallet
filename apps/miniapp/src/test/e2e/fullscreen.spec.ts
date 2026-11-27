/**
 * Fullscreen top-bar control under the production CSP at a narrow viewport.
 *
 * The browser Fullscreen API is stubbed so the wiring is deterministic in Chromium and WebKit.
 * The test also verifies the utility cluster never overflows at 360/375px and that no CSP
 * violation is reported while toggling.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const MINIAPP_ROOT = resolve(SELF_DIR, '..', '..', '..');
const PROJECT_ROOT = resolve(MINIAPP_ROOT, '..', '..');

function productionCsp(): string {
  const cfg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'vercel.json'), 'utf-8')) as {
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const rule = cfg.headers?.find((entry) => entry.source === '/(.*)');
  const csp = rule?.headers.find(
    (entry) => entry.key.toLowerCase() === 'content-security-policy',
  )?.value;
  if (!csp) throw new Error('vercel.json has no Content-Security-Policy header');
  return csp;
}

async function applyProductionCsp(page: Page, csp: string): Promise<string[]> {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP_VIOLATION ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on('console', (message) => {
    if (message.text().startsWith('CSP_VIOLATION')) violations.push(message.text());
  });
  await page.route('**/*', async (route) => {
    let response;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => undefined);
      return;
    }
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': csp },
    });
  });
  return violations;
}

/** Deterministic standard Fullscreen API for both Playwright engines. */
async function stubBrowserFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let element: Element | null = null;
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => element,
    });
    Element.prototype.requestFullscreen = function requestFullscreen(): Promise<void> {
      element = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    Document.prototype.exitFullscreen = function exitFullscreen(): Promise<void> {
      element = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });
}

const PORTFOLIO = {
  address: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
  network: 'testnet',
  status: 'active',
  balanceRaw: '1500000000',
  balance: '1.5',
  priceUsd: 1.5,
  change24h: 2,
  totalUsd: 2.25,
  assets: [
    {
      id: 'ton',
      symbol: 'TON',
      name: 'Toncoin',
      decimals: 9,
      standard: 'native',
      balanceRaw: '1500000000',
      balance: '1.5',
      usdValue: 2.25,
    },
  ],
  updatedAt: 0,
  source: 'toncenter',
};

async function mockTonApi(page: Page): Promise<void> {
  await page.route('**/api/ton/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/ton/config') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          network: 'testnet',
          swapEnabled: false,
          stakingEnabled: false,
          swapFeeBps: 0,
          referralConfigured: false,
        }),
      });
      return;
    }
    if (path.endsWith('/portfolio')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PORTFOLIO),
      });
      return;
    }
    if (path.endsWith('/activity')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '{}' });
  });
}

async function createWallet(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a wallet' }).click();
  await page.getByRole('button', { name: 'Show recovery phrase' }).click();
  await page.getByLabel("I've stored the seed phrase in a secure place.").check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('PIN', { exact: true }).fill('2580');
  await page.getByLabel('Confirm PIN').fill('2580');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('hero-balance')).toHaveText('$2.25');
}

/**
 * Mobile Telegram: `window.Telegram.WebApp` is injected but WITHOUT the Bot API 8.0 methods, the
 * mobile WebView has no standard Fullscreen API, and only `TelegramWebviewProxy` can be used.
 * This is the shape seen on iOS/Android clients, so the bridge must surface the control.
 */
async function installMobileTelegramBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const posts: string[] = [];
    const calls: Array<{ event: string; data?: string | undefined }> = [];
    const handlers = new Map<string, Array<(payload?: unknown) => void>>();
    (window as unknown as { __tgPosts: string[] }).__tgPosts = posts;
    (
      window as unknown as { __tgCalls: Array<{ event: string; data?: string | undefined }> }
    ).__tgCalls = calls;
    (window as unknown as { __emitTg: (event: string, payload?: unknown) => void }).__emitTg = (
      event,
      payload,
    ) => {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    };
    (window as unknown as { TelegramWebviewProxy: unknown }).TelegramWebviewProxy = {
      postEvent: (event: string, data?: string) => {
        posts.push(event);
        calls.push({ event, data });
      },
    };
    const webApp = {
      initData: '',
      initDataUnsafe: {},
      version: '10.0',
      platform: 'ios',
      colorScheme: 'light',
      themeParams: {},
      isExpanded: true,
      viewportHeight: 812,
      viewportStableHeight: 812,
      isVersionAtLeast: () => true,
      ready: () => undefined,
      expand: () => undefined,
      close: () => undefined,
      setHeaderColor: () => undefined,
      setBackgroundColor: () => undefined,
      enableClosingConfirmation: () => undefined,
      disableClosingConfirmation: () => undefined,
      onEvent: (event: string, callback: (payload?: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), callback]);
      },
      offEvent: (event: string, callback: (payload?: unknown) => void) => {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((entry) => entry !== callback),
        );
      },
      sendData: () => undefined,
      switchInlineQuery: () => undefined,
      openLink: () => undefined,
      openTelegramLink: () => undefined,
      openInvoice: () => false,
      showPopup: () => undefined,
      showAlert: () => undefined,
      showConfirm: () => undefined,
    };
    Object.defineProperty(window, 'Telegram', { value: { WebApp: webApp }, configurable: true });
    // Mobile WebViews have no standard Fullscreen API (iPhone Safari in particular).
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(Document.prototype, 'exitFullscreen', {
      configurable: true,
      value: undefined,
    });
  });
}

test.describe('fullscreen control', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('toggles fullscreen at 360/375px with no overflow and no CSP violations', async ({
    page,
  }) => {
    const csp = productionCsp();
    const violations = await applyProductionCsp(page, csp);
    await stubBrowserFullscreen(page);
    await mockTonApi(page);
    await createWallet(page);

    const enter = page.getByRole('button', { name: 'Enter fullscreen' });
    await expect(enter).toBeVisible();
    await expect(enter).toHaveAttribute('aria-pressed', 'false');

    await enter.click();
    const exit = page.getByRole('button', { name: 'Exit fullscreen' });
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    await exit.click();
    await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    for (const width of [375, 360]) {
      await page.setViewportSize({ width, height: 812 });
      const layout = await page.evaluate(() => {
        const header = document.querySelector('header');
        return {
          inner: window.innerWidth,
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          headerHeight: header?.getBoundingClientRect().height ?? 0,
        };
      });
      expect(layout.inner).toBe(width);
      expect(layout.doc).toBeLessThanOrEqual(width);
      expect(layout.body).toBeLessThanOrEqual(width);
      expect(layout.headerHeight).toBeLessThanOrEqual(64);
    }

    expect(violations).toEqual([]);
  });

  test('mobile Telegram: bridge fallback shows the toggle and posts fullscreen events', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installMobileTelegramBridge(page);
    await mockTonApi(page);
    await createWallet(page);

    // Mount: vertical swipes are locked and the native bar matches Mint Light.
    const chromeCalls = await page.evaluate(
      () => (window as unknown as { __tgCalls: Array<{ event: string; data?: string }> }).__tgCalls,
    );
    const payloadOf = (event: string): Array<string> =>
      chromeCalls.filter((call) => call.event === event).map((call) => call.data ?? '');
    expect(payloadOf('web_app_setup_swipe_behavior')).toContain(
      JSON.stringify({ allow_vertical_swipe: false }),
    );
    expect(payloadOf('web_app_set_header_color')).toContain(JSON.stringify({ color: '#DFF2E6' }));
    expect(payloadOf('web_app_set_background_color')).toContain(
      JSON.stringify({ color: '#DFF2E6' }),
    );

    const enter = page.getByTestId('fullscreen-toggle');
    await expect(enter).toBeVisible();
    await expect(enter).toHaveAttribute('aria-label', 'Enter fullscreen');

    await enter.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __tgPosts: string[] }).__tgPosts))
      .toContain('web_app_request_fullscreen');
    // Fresh insets are requested through the bridge on startup/state change.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __tgPosts: string[] }).__tgPosts))
      .toEqual(
        expect.arrayContaining(['web_app_request_safe_area', 'web_app_request_content_safe_area']),
      );

    // iOS confirms via TelegramGameProxy.receiveEvent (snake_case), not WebApp.onEvent.
    await page.evaluate(() => {
      (
        window as unknown as {
          TelegramGameProxy: { receiveEvent: (event: string, data: string) => void };
        }
      ).TelegramGameProxy.receiveEvent(
        'fullscreen_changed',
        JSON.stringify({ is_fullscreen: true }),
      );
    });
    const exit = page.getByTestId('fullscreen-toggle');
    await expect(exit).toHaveAttribute('aria-label', 'Exit fullscreen');

    // No false "unavailable" toast once the native confirmation arrives.
    await page.waitForTimeout(1700);
    await expect(page.getByText("Fullscreen isn't available on this device")).toHaveCount(0);

    // fullscreen_changed re-asserts the vertical swipe lock.
    const swipeLocks = await page.evaluate(
      () =>
        (window as unknown as { __tgCalls: Array<{ event: string }> }).__tgCalls.filter(
          (call) => call.event === 'web_app_setup_swipe_behavior',
        ).length,
    );
    expect(swipeLocks).toBeGreaterThan(1);

    // Native safe-area events clear Telegram's floating bar above our header. One payload is a
    // JSON string, the other an object, to cover both shapes iOS sends.
    await page.evaluate(() => {
      const bridge = (
        window as unknown as {
          TelegramGameProxy: { receiveEvent: (event: string, data: unknown) => void };
        }
      ).TelegramGameProxy;
      bridge.receiveEvent(
        'safe_area_changed',
        JSON.stringify({ top: 59, bottom: 34, left: 0, right: 0 }),
      );
      bridge.receiveEvent('content_safe_area_changed', { top: 52, bottom: 0, left: 0, right: 0 });
    });
    const fullscreenPadding = await page.evaluate(() => {
      const frame = document.querySelector('[data-testid="phone-frame"]');
      return frame ? Number.parseFloat(getComputedStyle(frame).paddingTop) : 0;
    });
    expect(fullscreenPadding).toBeGreaterThanOrEqual(100);

    await exit.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __tgPosts: string[] }).__tgPosts))
      .toContain('web_app_exit_fullscreen');

    // Leaving fullscreen removes the extra content clearance.
    await page.evaluate(() => {
      (
        window as unknown as {
          TelegramGameProxy: { receiveEvent: (event: string, data: string) => void };
        }
      ).TelegramGameProxy.receiveEvent(
        'fullscreen_changed',
        JSON.stringify({ is_fullscreen: false }),
      );
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--tg-content-safe-area-inset-top'),
        ),
      )
      .toBe('0px');

    // Toggling the theme syncs the native bar with Forest Dark.
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __tgCalls: Array<{ event: string; data?: string }> }).__tgCalls
            .filter((call) => call.event === 'web_app_set_header_color')
            .map((call) => call.data ?? ''),
        ),
      )
      .toContain(JSON.stringify({ color: '#0A0F0D' }));

    // Never clipped at the narrowest supported viewport, and Settings exposes the same control.
    await page.setViewportSize({ width: 360, height: 780 });
    const layout = await page.evaluate(() => ({
      inner: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      button: (() => {
        const element = document.querySelector('[data-testid="fullscreen-toggle"]');
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { right: rect.right, width: rect.width };
      })(),
    }));
    expect(layout.doc).toBeLessThanOrEqual(360);
    expect(layout.body).toBeLessThanOrEqual(360);
    expect(layout.button).not.toBeNull();
    // 36px target (sub-pixel allowed); it must be fully inside the viewport, never clipped.
    expect(layout.button?.width).toBeGreaterThanOrEqual(35);
    expect(layout.button?.right).toBeLessThanOrEqual(360);

    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('button', { name: /^Fullscreen/ })).toBeVisible();
  });
});
