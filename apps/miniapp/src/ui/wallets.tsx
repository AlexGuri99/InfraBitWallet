/**
 * "My Wallets" — multi-wallet manager (list, switch, create, import, rename, remove).
 *
 * Security invariants preserved:
 * - The phrase of a new/imported wallet lives only in `secretHolder` (never React state, never
 *   storage) and is cleared as soon as the wallet is sealed, or when this screen unmounts.
 * - Removing a wallet requires that wallet's recovery phrase, typed into an uncontrolled field;
 *   the seed comparison happens inside the vault session, not here.
 * - Adding a wallet requires the current PIN, because the new envelope is sealed under it.
 */
import { useEffect, useRef, useState } from 'react';
import {
  generateMnemonicPhrase,
  type AccountType,
  type VaultManager,
} from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { detectAccountType } from '../vault/detect';
import { Button, Card, ErrorText, Field, Notice, ScreenShell, Sheet } from './common';
import { InfraBitLogo } from './logo';
import { CreatePhraseScreen } from './onboarding';
import { DisambiguateScreen, ImportPhraseScreen } from './import';
import { useToast } from './toast';
import { PlusIcon, TrashIcon } from './icons';
import { shortAddress } from './asset';
import type { BiometryApi } from '../adapters/biometry';

type Mode =
  | { kind: 'list' }
  | { kind: 'create-phrase' }
  | { kind: 'import-phrase' }
  | { kind: 'disambiguate' }
  | { kind: 'passcode'; accountType: AccountType; source: 'create' | 'import' }
  | { kind: 'remove'; id: string; label: string };

function WalletRow({
  label,
  address,
  active,
  busy,
  onSwitch,
  onRename,
  onRemove,
  canRemove,
}: {
  label: string;
  address: string;
  active: boolean;
  busy: boolean;
  onSwitch: () => void;
  onRename: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <button
        type="button"
        onClick={onSwitch}
        disabled={active || busy}
        aria-label={`${label} · ${active ? t('wallets.active') : t('wallets.switch')}`}
        aria-pressed={active}
        className="pressable flex items-center gap-3 text-left disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
      >
        <InfraBitLogo size={38} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {label}
          </span>
          <span className="block truncate font-mono text-[11.5px] text-ink-2">
            {shortAddress(address, 6, 4)}
          </span>
        </span>
        {active ? (
          <span className="shrink-0 rounded-full bg-positive-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-positive">
            {t('wallets.active')}
          </span>
        ) : null}
      </button>
      <div className="flex items-center gap-2 pl-[50px]">
        <button
          type="button"
          onClick={onRename}
          className="pressable rounded-full bg-surface-secondary px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
        >
          {t('wallets.rename')}
        </button>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="pressable flex items-center gap-1 rounded-full bg-surface-secondary px-2.5 py-1 text-[11.5px] font-semibold text-negative focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          >
            <TrashIcon size={12} />
            {t('wallets.remove')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Single-field prompt for the CURRENT PIN (uncontrolled input). */
function WalletPasscodePrompt({
  manager,
  onSubmit,
  onBack,
  accountType,
}: {
  manager: VaultManager;
  onSubmit: (passcode: string) => Promise<string | null>;
  onBack: () => void;
  accountType: AccountType;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const passcode = ref.current?.value ?? '';
    const policy = manager.evaluatePasscode(passcode);
    if (ref.current) ref.current.value = '';
    if (!policy.ok) {
      setError(policy.error ?? t('passcode.weak'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const failure = await onSubmit(passcode);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title={t('wallets.passcodeTitle')} onBack={onBack}>
      <Notice>{t('wallets.passcodeBody')}</Notice>
      <p className="px-1 text-[12.5px] text-ink-2">
        {accountType === 'ton-native-only' ? t('accountType.tonNative') : t('accountType.bip39')}
      </p>
      <Field
        id="wallet-passcode"
        ref={ref}
        label={t('wallets.passcodeLabel')}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoComplete="current-password"
        autoFocus
        className="text-center font-mono text-[22px] tracking-[0.5em]"
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
        }}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={() => void submit()} disabled={busy}>
        {busy ? t('common.working') : t('wallets.submit')}
      </Button>
    </ScreenShell>
  );
}

function RemoveWalletScreen({
  manager,
  id,
  label,
  onDone,
  onBack,
}: {
  manager: VaultManager;
  id: string;
  label: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const phraseRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const phrase = phraseRef.current?.value ?? '';
    setBusy(true);
    setError(null);
    try {
      const result = await manager.removeWallet(id, phrase);
      if (!result.ok) {
        setError(
          result.error === 'phrase_mismatch'
            ? t('wallets.phraseMismatch')
            : result.error === 'last_wallet'
              ? t('wallets.lastWallet')
              : t('settings.error'),
        );
        return;
      }
      if (phraseRef.current) phraseRef.current.value = '';
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title={t('wallets.removeTitle')} onBack={onBack}>
      <Notice tone="warning">{t('wallets.removeBody')}</Notice>
      <p className="px-1 text-[13px] font-semibold text-ink">{label}</p>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="remove-wallet-phrase"
          className="px-1 text-[12.5px] font-semibold text-ink-2"
        >
          {t('wallets.removeField')}
        </label>
        <textarea
          id="remove-wallet-phrase"
          ref={phraseRef}
          rows={3}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="rounded-2xl border border-hairline bg-surface px-4 py-3 font-mono text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
        />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button variant="danger" onClick={() => void submit()} disabled={busy}>
        {busy ? t('common.working') : t('wallets.removeButton')}
      </Button>
    </ScreenShell>
  );
}

export function WalletManagerScreen({
  manager,
  biometry,
  onBack,
  onChanged,
}: {
  manager: VaultManager;
  biometry: BiometryApi;
  onBack: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Leaving the screen always drops a temporary phrase.
  useEffect(
    () => () => {
      secretHolder.clear();
    },
    [],
  );

  const session = manager.getSession();
  const wallets = session?.listWallets() ?? [];

  const refresh = (): void => {
    setVersion((value) => value + 1);
    onChanged();
  };

  const startCreate = (): void => {
    secretHolder.set(generateMnemonicPhrase(24));
    setMode({ kind: 'create-phrase' });
  };

  const startImport = (): void => {
    secretHolder.clear();
    setMode({ kind: 'import-phrase' });
  };

  const importNext = async (words: string[], forceTonNative: boolean): Promise<string | null> => {
    const phrase = words.join(' ');
    const detected = await detectAccountType(phrase, { forceTonNative });
    if (detected.kind === 'invalid') return detected.message;
    secretHolder.set(phrase);
    if (detected.kind === 'ambiguous') {
      setMode({ kind: 'disambiguate' });
      return null;
    }
    setMode({ kind: 'passcode', accountType: detected.accountType, source: 'import' });
    return null;
  };

  const chooseAmbiguous = (accountType: AccountType): void => {
    setMode({ kind: 'passcode', accountType, source: 'import' });
  };

  const sealWallet = async (passcode: string): Promise<string | null> => {
    if (mode.kind !== 'passcode') return t('settings.error');
    const phrase = secretHolder.get();
    if (!phrase) return t('settings.error');
    const result = await manager.addWallet({
      passcode,
      mnemonic: phrase,
      accountType: mode.accountType,
      activate: true,
    });
    if (!result.ok) {
      return result.error === 'wrong_passcode'
        ? t('unlock.wrong')
        : result.error === 'duplicate_wallet'
          ? t('wallets.duplicate')
          : result.error === 'wallet_limit'
            ? t('wallets.limit')
            : t('settings.error');
    }
    secretHolder.clear();
    toast.show(mode.source === 'create' ? t('wallets.added') : t('wallets.imported'));
    if (result.biometricDropped) {
      await biometry.updateToken(null);
      toast.show(t('wallets.biometricDropped'));
    }
    setMode({ kind: 'list' });
    refresh();
    return null;
  };

  const switchTo = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      const result = await manager.switchWallet(id);
      if (!result.ok) {
        toast.show(t('settings.error'));
        return;
      }
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  const saveRename = async (): Promise<void> => {
    if (!renaming) return;
    const result = await manager.renameWallet(renaming.id, renaming.label);
    if (!result.ok) {
      toast.show(t('settings.error'));
      return;
    }
    toast.show(t('wallets.renamed'));
    setRenaming(null);
    refresh();
  };

  if (mode.kind === 'create-phrase') {
    return (
      <CreatePhraseScreen
        step={{ current: 1, total: 2 }}
        onBack={() => {
          secretHolder.clear();
          setMode({ kind: 'list' });
        }}
        onDone={() => {
          setMode({ kind: 'passcode', accountType: 'bip39-multichain', source: 'create' });
        }}
      />
    );
  }

  if (mode.kind === 'import-phrase') {
    return (
      <ImportPhraseScreen
        step={{ current: 1, total: 2 }}
        onBack={() => {
          secretHolder.clear();
          setMode({ kind: 'list' });
        }}
        onNext={importNext}
      />
    );
  }

  if (mode.kind === 'disambiguate') {
    return (
      <DisambiguateScreen
        onBack={() => {
          secretHolder.clear();
          setMode({ kind: 'import-phrase' });
        }}
        onChoose={chooseAmbiguous}
      />
    );
  }

  if (mode.kind === 'passcode') {
    return (
      <WalletPasscodePrompt
        manager={manager}
        accountType={mode.accountType}
        onBack={() => {
          secretHolder.clear();
          setMode({ kind: 'list' });
        }}
        onSubmit={sealWallet}
      />
    );
  }

  if (mode.kind === 'remove') {
    return (
      <RemoveWalletScreen
        manager={manager}
        id={mode.id}
        label={mode.label}
        onBack={() => {
          setMode({ kind: 'list' });
        }}
        onDone={() => {
          toast.show(t('wallets.removed'));
          setMode({ kind: 'list' });
          refresh();
        }}
      />
    );
  }

  return (
    <ScreenShell title={t('wallets.title')} onBack={onBack}>
      <p className="px-1 text-[12.5px] leading-relaxed text-ink-2">{t('wallets.subtitle')}</p>

      <Card>
        {wallets.map((wallet, index) => (
          <div key={`${wallet.id}-${String(version)}`}>
            {index > 0 ? <div className="ml-16 h-px bg-hairline" aria-hidden="true" /> : null}
            <WalletRow
              label={wallet.label}
              address={wallet.tonAddress}
              active={wallet.active}
              busy={busyId === wallet.id}
              canRemove={wallets.length > 1}
              onSwitch={() => void switchTo(wallet.id)}
              onRename={() => {
                setRenaming({ id: wallet.id, label: wallet.label });
              }}
              onRemove={() => {
                setMode({ kind: 'remove', id: wallet.id, label: wallet.label });
              }}
            />
          </div>
        ))}
      </Card>

      <div className="flex flex-col gap-2.5">
        <Button onClick={startCreate}>
          <PlusIcon size={16} />
          {t('wallets.create')}
        </Button>
        <Button variant="secondary" onClick={startImport}>
          {t('wallets.import')}
        </Button>
      </div>

      <p className="px-1 text-[11.5px] text-ink-muted">{t('welcome.never.ask')}</p>

      {renaming ? (
        <Sheet
          title={t('wallets.renameTitle')}
          onClose={() => {
            setRenaming(null);
          }}
        >
          <label htmlFor="wallet-name" className="px-1 text-[12.5px] font-semibold text-ink-2">
            {t('wallets.renameLabel')}
          </label>
          <input
            id="wallet-name"
            value={renaming.label}
            maxLength={40}
            autoComplete="off"
            onChange={(event) => {
              setRenaming({ ...renaming, label: event.target.value });
            }}
            className="min-h-12 rounded-2xl border border-hairline bg-surface px-4 text-[15px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          />
          <Button onClick={() => void saveRename()}>{t('wallets.save')}</Button>
        </Sheet>
      ) : null}
    </ScreenShell>
  );
}
