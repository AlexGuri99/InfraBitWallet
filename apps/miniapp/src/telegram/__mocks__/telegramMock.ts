// Mock Telegram WebApp environment for local development.
// Import and call this before React renders when running outside Telegram.

let initialized = false;

export function mockTelegramEnvironment(): void {
  if (initialized) return;
  initialized = true;

  const mockStorage = new Map<string, string>();

  const mockWebApp = {
    initData: 'mock_init_data',
    initDataUnsafe: {
      query_id: 'mock_query',
      user: {
        id: 12345,
        first_name: 'Test',
        last_name: 'User',
        username: 'testuser',
        language_code: 'en',
      },
      auth_date: Math.floor(Date.now() / 1000),
      hash: 'mock_hash',
    },
    version: '10.0',
    platform: 'mock',
    colorScheme: 'light' as const,
    themeParams: {
      bg_color: '#ffffff',
      text_color: '#000000',
      hint_color: '#999999',
      link_color: '#2481cc',
      button_color: '#2481cc',
      button_text_color: '#ffffff',
      header_bg_color: '#f0f0f0',
      accent_text_color: '#2481cc',
      section_bg_color: '#ffffff',
      section_separator_color: '#e0e0e0',
      subtitle_text_color: '#999999',
      destructive_text_color: '#ff3b30',
    },
    isExpanded: true,
    viewportHeight: window.innerHeight,
    viewportStableHeight: window.innerHeight,
    isVersionAtLeast: (version: string) => {
      const parts = version.split('.').map(Number);
      const current = [10, 0];
      for (let i = 0; i < Math.max(parts.length, current.length); i++) {
        const a = parts[i] ?? 0;
        const b = current[i] ?? 0;
        if (a !== b) return a <= b;
      }
      return true;
    },
    ready: () => {},
    expand: () => {},
    close: () => {},
    setHeaderColor: () => {},
    setBackgroundColor: () => {},
    enableClosingConfirmation: () => {},
    disableClosingConfirmation: () => {},
    onEvent: () => {},
    offEvent: () => {},
    sendData: () => {},
    switchInlineQuery: () => {},
    openLink: () => {},
    openTelegramLink: () => {},
    openInvoice: () => true,
    showPopup: () => {},
    showAlert: () => {},
    showConfirm: () => {},
    SecureStorage: {
      // eslint-disable-next-line @typescript-eslint/require-await
      getItem: async (key: string) => mockStorage.get(key) ?? null,
      // eslint-disable-next-line @typescript-eslint/require-await
      setItem: async (key: string, value: string) => {
        mockStorage.set(key, value);
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      removeItem: async (key: string) => {
        mockStorage.delete(key);
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      clear: async () => {
        mockStorage.clear();
      },
    },
    BiometricManager: {
      init: () => {},
      isInited: true,
      isBiometricAvailable: true,
      biometricType: 'finger',
      isAccessRequested: true,
      isAccessGranted: true,
      isBiometricTokenSaved: true,
      requestAccess: () => {},
      authenticate: (_params: { reason?: string }, callback?: (isSuccess: boolean) => void) => {
        callback?.(true);
      },
      updateBiometricToken: () => {},
      openSettings: () => {},
    },
  };

  window.Telegram = { WebApp: mockWebApp as unknown as NonNullable<Window['Telegram']>['WebApp'] };
}
