/**
 * Thin adapter over the Telegram SDK biometry component.
 *
 * Feature-detected at every call; outside Telegram every method resolves to unavailable/false
 * instead of throwing. Injectable for component tests.
 *
 * Source: @telegram-apps/sdk biometry component (Mini Apps ≥ 7.2) and
 * https://core.telegram.org/bots/webapps (BiometricManager): authenticate releases a token that
 * was previously saved with updateBiometricToken.
 */
import {
  authenticateBiometry,
  biometryState,
  isBiometryAvailable,
  isBiometryMounted,
  mountBiometry,
  openBiometrySettings,
  requestBiometryAccess,
  updateBiometryToken,
} from '@telegram-apps/sdk';

export interface BiometryApi {
  /** Whether biometrics is available on this device (mounts the component when needed). */
  available(): Promise<boolean>;
  /** Whether a biometric token is stored on the device. */
  tokenSaved(): boolean;
  requestAccess(reason: string): Promise<boolean>;
  /** Returns the stored token after a successful biometric check, or undefined. */
  authenticate(reason: string): Promise<string | undefined>;
  updateToken(token: string | null): Promise<boolean>;
  openSettings(): void;
}

async function ensureMounted(): Promise<boolean> {
  try {
    if (!isBiometryMounted() && mountBiometry.isAvailable()) await mountBiometry(undefined);
    return isBiometryAvailable();
  } catch {
    return false;
  }
}

export function createSdkBiometryApi(): BiometryApi {
  return {
    async available() {
      return ensureMounted();
    },
    tokenSaved() {
      try {
        return biometryState().tokenSaved;
      } catch {
        return false;
      }
    },
    async requestAccess(reason) {
      try {
        if (!(await ensureMounted())) return false;
        if (!requestBiometryAccess.isAvailable()) return false;
        return await requestBiometryAccess({ reason });
      } catch {
        return false;
      }
    },
    async authenticate(reason) {
      try {
        if (!(await ensureMounted())) return undefined;
        if (!authenticateBiometry.isAvailable()) return undefined;
        const { token } = await authenticateBiometry({ reason });
        return token;
      } catch {
        return undefined;
      }
    },
    async updateToken(token) {
      try {
        if (!(await ensureMounted())) return false;
        if (!updateBiometryToken.isAvailable()) return false;
        const status = await updateBiometryToken(token ? { token } : {});
        return status === 'updated';
      } catch {
        return false;
      }
    },
    openSettings() {
      try {
        if (openBiometrySettings.isAvailable()) openBiometrySettings();
      } catch {
        // Unavailable outside Telegram; nothing to do.
      }
    },
  };
}
