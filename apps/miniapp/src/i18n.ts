/**
 * Minimal i18n scaffold (English only for now).
 *
 * Usage: `t('welcome.title')`. Adding a locale means adding a dictionary and a `lang` state;
 * no component should hardcode user-facing copy. Accessibility labels are included here too.
 */
const en = {
  'app.name': 'OneZeroWallet',
  'app.tagline': 'A self-custodial multi-chain wallet for Telegram',
  'welcome.title': 'Your keys, your coins',
  'welcome.body':
    'You control this wallet. No one — including us — can recover your recovery phrase or your funds if you lose it.',
  'welcome.telegram.body':
    'Telegram or your device may clear local data. Write your recovery phrase on paper and keep it offline.',
  'welcome.never.ask': 'We will never ask for your recovery phrase.',
  'welcome.support': 'Official support: only through the official bot listed on our website.',
  'welcome.create': 'Create a wallet',
  'welcome.import': 'Import a wallet',
  'onboarding.risk.title': 'Before you start',
  'onboarding.risk.points':
    'You are the only person who can access these funds. A lost recovery phrase cannot be restored. Local data can be cleared.',
  'onboarding.continue': 'I understand, continue',
  'passcode.title': 'Set a passcode',
  'passcode.label': 'Passcode',
  'passcode.confirm': 'Confirm passcode',
  'passcode.mismatch': 'The passcodes do not match',
  'passcode.deviceSecret':
    'This device protects the vault with a device secret stored by Telegram.',
  'passcode.noDeviceSecret':
    'No device secret is available here. Use a long passphrase; the vault can be attacked offline if copied.',
  'passcode.weak': 'Passcode is too weak',
  'passcode.submit': 'Continue',
  'accountType.label': 'Wallet type',
  'accountType.bip39': 'Standard wallet (24-word phrase for TON, TRON and EVM)',
  'accountType.tonNative': 'TON-native phrase (TON only)',
  'accountType.tonNative.help': 'Only choose this if your existing phrase came from a TON wallet.',
  'phrase.title': 'Your recovery phrase',
  'phrase.warning':
    'Write these words on paper, in order, and keep them offline. Anyone who sees them can steal your funds. Do not take screenshots.',
  'phrase.reveal': 'Show recovery phrase',
  'phrase.revealAgain': 'Show again',
  'phrase.hide': 'Hide phrase',
  'phrase.done': 'I wrote it down',
  'phrase.settings.warning':
    'This phrase is your only backup. Make sure no one can see your screen.',
  'verify.title': 'Check your backup',
  'verify.body': 'Enter the words at the positions below. This proves your backup is readable.',
  'verify.wordAt': 'Word',
  'verify.submit': 'Verify',
  'verify.retry': 'One or more words are incorrect. Check the positions and try again.',
  'verify.success': 'Backup verified.',
  'import.title': 'Import a wallet',
  'import.phrase': 'Recovery phrase',
  'import.phraseHelp': 'Words separated by spaces. Never type it anywhere else.',
  'import.submit': 'Import',
  'import.invalid': 'That phrase is not valid for the selected wallet type.',
  'unlock.title': 'Welcome back',
  'unlock.passcode': 'Passcode',
  'unlock.submit': 'Unlock',
  'unlock.biometric': 'Unlock with biometrics',
  'unlock.wrong': 'Wrong passcode',
  'unlock.rateLimited': 'Too many attempts. Try again in',
  'unlock.deviceSecretMissing':
    'This device secret is gone, so this backup cannot be opened. Restore from your recovery phrase.',
  'unlock.wiped': 'The wallet was wiped after too many failed attempts.',
  'unlock.storage': 'Secure storage is unavailable in this environment.',
  'unlock.kdf': 'Key derivation is unavailable in this environment.',
  'home.title': 'Your wallet',
  'home.lock': 'Lock',
  'home.settings': 'Settings',
  'home.copy': 'Copy',
  'home.copied': 'Copied',
  'home.receive': 'Receive',
  'home.tonPrefer': 'Use this non-bounceable address for first-time senders.',
  'home.notice': 'We will never ask for your recovery phrase.',
  'settings.title': 'Settings',
  'settings.back': 'Back',
  'settings.reveal': 'Reveal recovery phrase',
  'settings.testBackup': 'Test your backup',
  'settings.changePasscode': 'Change passcode',
  'settings.oldPasscode': 'Current passcode',
  'settings.newPasscode': 'New passcode',
  'settings.confirmPasscode': 'Confirm new passcode',
  'settings.save': 'Save',
  'settings.changed': 'Passcode changed.',
  'settings.biometrics': 'Biometric unlock',
  'settings.biometrics.on': 'Enabled',
  'settings.biometrics.off': 'Disabled',
  'settings.biometrics.enable': 'Enable',
  'settings.biometrics.disable': 'Disable',
  'settings.biometrics.explain':
    'A successful biometric check on this unlocked device can open the wallet without the passcode. The passcode is still required to reveal the phrase, change it, or turn biometrics off.',
  'settings.autoLock': 'Auto-lock after inactivity',
  'settings.autoLock.min1': '1 minute',
  'settings.autoLock.min5': '5 minutes',
  'settings.autoLock.min15': '15 minutes',
  'settings.wipe': 'Wipe this wallet',
  'settings.wipeConfirm':
    'Type WIPE to confirm. Without your recovery phrase this cannot be undone.',
  'settings.wipeButton': 'Wipe',
  'settings.requiresPasscode': 'Enter your passcode to continue',
  'settings.error': 'Something went wrong',
  'common.cancel': 'Cancel',
  'common.working': 'Working…',
  'error.storage': 'Secure storage is unavailable, so the wallet cannot start on this device.',
} as const;

export type MessageKey = keyof typeof en;

export function t(key: MessageKey): string {
  return en[key];
}

export const activeLanguage = 'en' as const;
