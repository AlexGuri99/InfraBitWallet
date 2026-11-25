/**
 * Wallet shell: owns live TON data, tab state and drill-in routing.
 *
 * Data comes only from the same-origin `/api/ton/*` proxy. The shell keeps no secret — only the
 * vault manager it was handed and public chain data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VaultManager } from '@onezerowallet/crypto-vault';
import {
  filterActivity,
  formatDecimal,
  type DecodedSignedTransfer,
  type TonActivityItem,
  type TonPortfolio,
} from '@onezerowallet/chain-ton';
import type { AssetView } from './asset';
import { staticChainAssets, tonAssetView } from './asset';
import type { Load } from './home';
import { WalletHome } from './home';
import { BottomNav, type WalletTab } from './nav';
import { PhoneFrame } from './common';
import { DepositScreen } from './deposit';
import { SendScreen, type SendPrefill } from './send';
import { TradeScreen } from './trade';
import { EarnScreen } from './earn';
import { CoinDetailScreen } from './coin-detail';
import { TxDetailScreen } from './tx-detail';
import { MarketScreen } from './market';
import { AssistantScreen } from './assistant';
import { SettingsTab } from './wallet';
import type { TonReadApi, TonSwapApi, TonWriteApi } from '../ton/api';
import type { BiometryApi } from '../adapters/biometry';
import { useToast } from './toast';
import { FullscreenProvider } from '../telegram/fullscreen';
import { t } from '../i18n';

export const UI_TON_NETWORK = 'testnet' as const;

type Route =
  | { kind: 'root' }
  | { kind: 'deposit' }
  | { kind: 'send'; prefill: SendPrefill }
  | { kind: 'trade' }
  | { kind: 'earn' }
  | { kind: 'coin'; asset: AssetView }
  | { kind: 'tx'; item: TonActivityItem };

function placeholderAssets(
  state: 'loading' | 'error',
  hasTron: boolean,
  hasEvm: boolean,
): AssetView[] {
  const mark = state === 'error' ? '—' : '…';
  const rows: AssetView[] = [
    {
      key: 'placeholder-ton',
      id: 'ton',
      symbol: 'TON',
      name: 'Toncoin',
      decimals: 9,
      standard: 'native',
      balanceRaw: '0',
      balance: mark,
      usdValue: null,
      chain: 'ton',
      badge: 'TON',
      live: false,
      testId: 'asset-TON',
    },
    {
      key: 'placeholder-usdt',
      id: 'usdt',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      standard: 'jetton',
      balanceRaw: '0',
      balance: mark,
      usdValue: null,
      chain: 'ton',
      badge: 'TON · Jetton',
      live: false,
      testId: 'asset-USDT',
    },
  ];
  return [...rows, ...staticChainAssets(hasTron, hasEvm)];
}

function WalletShellContent({
  manager,
  api,
  biometry,
  tab,
  onTabChange,
  onLock,
  onRevealPhrase,
  onTestBackup,
  onWiped,
}: {
  manager: VaultManager;
  api: TonReadApi & TonWriteApi & TonSwapApi;
  biometry: BiometryApi;
  tab: WalletTab;
  onTabChange: (tab: WalletTab) => void;
  onLock: () => void;
  onRevealPhrase: () => void;
  onTestBackup: () => void;
  onWiped: () => void;
}) {
  const session = manager.getSession();
  const info = session?.getPublicInfo(0) ?? null;
  const tonAddress = info?.ton.addressTestnetNonBounceable ?? '';
  const toast = useToast();
  const [route, setRoute] = useState<Route>({ kind: 'root' });
  const [portfolio, setPortfolio] = useState<Load<TonPortfolio>>({ state: 'loading' });
  const [activity, setActivity] = useState<Load<TonActivityItem[]>>({ state: 'loading' });
  const [pending, setPending] = useState<TonActivityItem | null>(null);
  const baselineRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!tonAddress) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPortfolio({ state: 'loading' });
    setActivity({ state: 'loading' });
    const [portfolioResult, activityResult] = await Promise.allSettled([
      api.getPortfolio(tonAddress, UI_TON_NETWORK, controller.signal),
      api.getActivity(tonAddress, UI_TON_NETWORK, 20, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setPortfolio(
      portfolioResult.status === 'fulfilled'
        ? { state: 'ready', value: portfolioResult.value }
        : { state: 'error' },
    );
    setActivity(
      activityResult.status === 'fulfilled'
        ? { state: 'ready', value: filterActivity(activityResult.value) }
        : { state: 'error' },
    );
  }, [api, tonAddress]);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  // While a submitted transfer is pending, poll and clear when Activity grows or after 60s.
  useEffect(() => {
    if (!pending) return;
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    const timeout = window.setTimeout(() => {
      setPending(null);
    }, 60_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [pending, refresh]);

  useEffect(() => {
    if (!pending) return;
    if (activity.state === 'ready' && activity.value.length > baselineRef.current) {
      setPending(null);
    }
  }, [activity, pending]);

  const portfolioReady = portfolio.state === 'ready' ? portfolio.value : null;
  const hasTron = info?.tron !== undefined;
  const hasEvm = info?.evm !== undefined;
  const assets: AssetView[] = portfolioReady
    ? [...portfolioReady.assets.map(tonAssetView), ...staticChainAssets(hasTron, hasEvm)]
    : placeholderAssets(portfolio.state === 'error' ? 'error' : 'loading', hasTron, hasEvm);
  const activityItems = activity.state === 'ready' ? activity.value : [];

  const openSend = (prefill: SendPrefill): void => {
    if (!portfolioReady) {
      toast.show(t('send.syncFirst'));
      return;
    }
    setRoute({ kind: 'send', prefill });
  };

  const handleSubmitted = (
    decoded: DecodedSignedTransfer,
    submittedAsset: { symbol: string; decimals: number; amountRaw?: string | undefined },
  ): void => {
    baselineRef.current = activity.state === 'ready' ? activity.value.length : 0;
    setPending({
      id: `pending-${decoded.messageHash.hex.slice(0, 12)}`,
      direction: 'out',
      standard: decoded.asset.type === 'ton' ? 'native' : 'jetton',
      symbol: submittedAsset.symbol,
      decimals: submittedAsset.decimals,
      amountRaw: submittedAsset.amountRaw ?? decoded.amountRaw,
      amount: formatDecimal(submittedAsset.amountRaw ?? decoded.amountRaw, submittedAsset.decimals),
      counterparty: decoded.recipient,
      timestamp: Math.floor(Date.now() / 1000),
      feeRaw: '0',
      fee: '0',
      status: 'pending',
      hash: decoded.messageHash.base64,
      comment: decoded.comment,
      isScam: false,
      isBounce: false,
    });
  };

  const findAssetForItem = (item: TonActivityItem): AssetView | undefined =>
    assets.find(
      (asset) =>
        asset.symbol.toUpperCase() === item.symbol.toUpperCase() &&
        (item.standard === 'native' ? asset.standard === 'native' : asset.standard === 'jetton'),
    );

  if (route.kind === 'deposit' && info) {
    return (
      <DepositScreen
        info={info}
        tonAddress={tonAddress}
        onBack={() => {
          setRoute({ kind: 'root' });
        }}
      />
    );
  }
  if (route.kind === 'send' && info && portfolioReady) {
    return (
      <SendScreen
        manager={manager}
        info={info}
        portfolio={portfolioReady}
        api={api}
        prefill={route.prefill}
        onBack={() => {
          setRoute({ kind: 'root' });
        }}
        onSubmitted={handleSubmitted}
      />
    );
  }
  if (route.kind === 'trade' && info && portfolioReady) {
    return (
      <TradeScreen
        manager={manager}
        info={info}
        portfolio={portfolioReady}
        api={api}
        onBack={() => {
          setRoute({ kind: 'root' });
        }}
        onSubmitted={handleSubmitted}
      />
    );
  }
  if (route.kind === 'earn') {
    return (
      <EarnScreen
        onBack={() => {
          setRoute({ kind: 'root' });
        }}
      />
    );
  }
  if (route.kind === 'coin') {
    return (
      <CoinDetailScreen
        asset={route.asset}
        activity={activityItems}
        change24h={route.asset.standard === 'native' ? (portfolioReady?.change24h ?? null) : null}
        onBack={() => {
          setRoute({ kind: 'root' });
        }}
        onDeposit={() => {
          setRoute({ kind: 'deposit' });
        }}
        onSend={(asset) => {
          openSend({ assetId: asset.id });
        }}
        onOpenTx={(item) => {
          setRoute({ kind: 'tx', item });
        }}
      />
    );
  }
  if (route.kind === 'tx') {
    return (
      <TxDetailScreen
        item={route.item}
        onBack={() => {
          setRoute({ kind: 'root' });
        }}
        onRepeat={(item) => {
          const asset = findAssetForItem(item);
          openSend({ assetId: asset?.id, recipient: item.counterparty });
        }}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-canvas">
      {tab === 'wallet' ? (
        <PhoneFrame>
          <main className="flex-1">
            <WalletHome
              info={info}
              tonAddress={tonAddress}
              portfolio={portfolio}
              activity={activity}
              pending={pending}
              assets={assets}
              onRefresh={() => {
                void refresh();
              }}
              onOpenSettings={() => {
                onTabChange('settings');
              }}
              onOpenDeposit={() => {
                setRoute({ kind: 'deposit' });
              }}
              onOpenSend={() => {
                openSend({});
              }}
              onOpenTrade={() => {
                setRoute({ kind: 'trade' });
              }}
              onOpenEarn={() => {
                setRoute({ kind: 'earn' });
              }}
              onOpenCoin={(asset) => {
                setRoute({ kind: 'coin', asset });
              }}
              onOpenTx={(item) => {
                setRoute({ kind: 'tx', item });
              }}
              onLock={onLock}
              onTabChange={onTabChange}
            />
          </main>
        </PhoneFrame>
      ) : null}

      {tab === 'market' ? <MarketScreen /> : null}
      {tab === 'assistant' ? <AssistantScreen /> : null}
      {tab === 'settings' ? (
        <SettingsTab
          manager={manager}
          biometry={biometry}
          info={info}
          tonAddress={tonAddress}
          balanceUsd={portfolioReady?.totalUsd ?? null}
          onLock={onLock}
          onReveal={onRevealPhrase}
          onTestBackup={onTestBackup}
          onWiped={onWiped}
        />
      ) : null}

      <BottomNav active={tab} onChange={onTabChange} />
    </div>
  );
}

/** Fullscreen/safe-area context lives for the whole authenticated wallet shell. */
export function WalletShell(props: Parameters<typeof WalletShellContent>[0]) {
  return (
    <FullscreenProvider>
      <WalletShellContent {...props} />
    </FullscreenProvider>
  );
}
