/**
 * Map provider payloads into the shared chain-ton read models.
 *
 * - Balances are decimal integer strings; formatting uses BigInt (chain-ton helpers).
 * - Transfer comments are attacker-controlled: URLs are neutralized and zero-value scam dust
 *   is filtered before anything reaches the UI.
 * - Native coin metadata is the registry's TON entry, never a provider string.
 */
import { Cell } from '@ton/core';
import { Buffer } from 'node:buffer';
import {
  filterActivity,
  formatDecimal,
  neutralizeComment,
  type TonActivityItem,
  type TonAssetBalance,
  type TonNetwork,
  type TonPortfolio,
} from '@onezerowallet/chain-ton';
import type { TonApiEvent, TonApiJettonMeta, TonApiPrice } from './tonapi.js';
import type { TonCenterMessage, TonCenterTransaction, TonCenterTransactions } from './toncenter.js';
import { NATIVE_TON, jettonAsset, nativeAsset } from './token-registry.js';

interface DecodedBody {
  comment: string | null;
  jettonAmountRaw: string | null;
  destination: string | null;
  isBounce: boolean;
}

const EMPTY_BODY: DecodedBody = {
  comment: null,
  jettonAmountRaw: null,
  destination: null,
  isBounce: false,
};

function decodeBody(body: string | null): DecodedBody {
  if (!body) return EMPTY_BODY;
  try {
    const cells = Cell.fromBoc(Buffer.from(body, 'base64'));
    const cell = cells[0];
    if (!cell) return EMPTY_BODY;
    const slice = cell.beginParse();
    if (slice.remainingBits < 32) return EMPTY_BODY;
    const op = slice.loadUint(32);
    if (op === 0) {
      return { ...EMPTY_BODY, comment: slice.loadStringTail() };
    }
    if (op === 0xffffffff) {
      // A bounced message body starts with ~0^32; this is an automatic refund, not a user send.
      return { ...EMPTY_BODY, isBounce: true };
    }
    if (op === 0x0f8a7ea5) {
      // jetton transfer: query_id, amount, destination, response, ...
      slice.loadUintBig(64);
      const amount = slice.loadCoins();
      const destination = slice.loadAddress().toRawString();
      return { comment: null, jettonAmountRaw: amount.toString(), destination, isBounce: false };
    }
    if (op === 0x178d4519) {
      // jetton internal_transfer: query_id, amount, from, response, ...
      slice.loadUintBig(64);
      const amount = slice.loadCoins();
      return {
        comment: null,
        jettonAmountRaw: amount.toString(),
        destination: null,
        isBounce: false,
      };
    }
    return EMPTY_BODY;
  } catch {
    return EMPTY_BODY;
  }
}

function friendly(address: string | null, book: Record<string, string>): string {
  if (!address) return '';
  return book[address] ?? address;
}

export function buildPortfolio(args: {
  address: string;
  network: TonNetwork;
  status: TonPortfolio['status'];
  balanceRaw: string;
  jettonWallets: Array<{ address: string; jetton: string; balanceRaw: string }>;
  metadata: Record<string, TonApiJettonMeta | null>;
  price: TonApiPrice;
  updatedAt: number;
}): TonPortfolio {
  const native = nativeAsset(args.balanceRaw, args.price.usd);
  const assets: TonAssetBalance[] = [
    native,
    ...args.jettonWallets.map((wallet) =>
      jettonAsset(
        wallet.jetton,
        wallet.balanceRaw,
        args.metadata[wallet.jetton] ?? null,
        wallet.address,
      ),
    ),
  ];
  const totalUsd =
    args.price.usd === null ? null : assets.reduce((sum, asset) => sum + (asset.usdValue ?? 0), 0);
  return {
    address: args.address,
    network: args.network,
    status: args.status,
    balanceRaw: native.balanceRaw,
    balance: native.balance,
    priceUsd: args.price.usd,
    change24h: args.price.change24h,
    totalUsd,
    assets,
    updatedAt: args.updatedAt,
    source: 'toncenter',
  };
}

function txStatus(tx: TonCenterTransaction): TonActivityItem['status'] {
  return tx.success ? 'ok' : 'failed';
}

export function mapTonCenterActivity(
  response: TonCenterTransactions,
  jettonWallets: Array<{ address: string; jetton: string; balanceRaw: string }>,
  metadata: Record<string, TonApiJettonMeta | null>,
): TonActivityItem[] {
  const walletToMaster = new Map(
    jettonWallets.map((wallet) => [wallet.address.toLowerCase(), wallet.jetton]),
  );
  const items: TonActivityItem[] = [];
  const fee = (tx: TonCenterTransaction): { feeRaw: string; fee: string } => ({
    feeRaw: tx.totalFeesRaw,
    fee: formatDecimal(tx.totalFeesRaw, NATIVE_TON.decimals),
  });

  for (const tx of response.transactions) {
    const inMsg = tx.inMessage;
    if (inMsg) {
      const body = decodeBody(inMsg.body);
      const nativeValue = /^\d+$/.test(inMsg.valueRaw) ? BigInt(inMsg.valueRaw) : 0n;
      if (nativeValue > 0n && inMsg.source !== null && !inMsg.source.startsWith('-1:0')) {
        items.push({
          id: `${tx.hash}:${tx.lt}:in`,
          direction: 'in',
          standard: 'native',
          symbol: NATIVE_TON.symbol,
          decimals: NATIVE_TON.decimals,
          amountRaw: nativeValue.toString(),
          amount: formatDecimal(nativeValue.toString(), NATIVE_TON.decimals),
          counterparty: friendly(inMsg.source, response.addressBook),
          timestamp: tx.now,
          ...fee(tx),
          status: txStatus(tx),
          hash: tx.hash,
          comment: neutralizeComment(body.comment),
          isScam: false,
          isBounce: inMsg.bounced || body.isBounce,
        });
      } else if (body.jettonAmountRaw !== null) {
        const master = inMsg.source ? walletToMaster.get(inMsg.source.toLowerCase()) : undefined;
        const meta = master ? (metadata[master] ?? null) : null;
        items.push({
          id: `${tx.hash}:${tx.lt}:jin`,
          direction: 'in',
          standard: 'jetton',
          symbol: meta?.symbol ?? 'JETTON',
          decimals: meta?.decimals ?? 9,
          amountRaw: body.jettonAmountRaw,
          amount: formatDecimal(body.jettonAmountRaw, meta?.decimals ?? 9),
          counterparty: friendly(inMsg.source, response.addressBook),
          timestamp: tx.now,
          ...fee(tx),
          status: txStatus(tx),
          hash: tx.hash,
          comment: null,
          isScam: meta?.isScam ?? false,
        });
      }
    }

    tx.outMessages.forEach((outMsg: TonCenterMessage, index) => {
      const body = decodeBody(outMsg.body);
      const nativeValue = /^\d+$/.test(outMsg.valueRaw) ? BigInt(outMsg.valueRaw) : 0n;
      if (nativeValue > 0n && outMsg.destination !== null) {
        items.push({
          id: `${tx.hash}:${tx.lt}:out:${String(index)}`,
          direction: 'out',
          standard: 'native',
          symbol: NATIVE_TON.symbol,
          decimals: NATIVE_TON.decimals,
          amountRaw: nativeValue.toString(),
          amount: formatDecimal(nativeValue.toString(), NATIVE_TON.decimals),
          counterparty: friendly(outMsg.destination, response.addressBook),
          timestamp: tx.now,
          ...fee(tx),
          status: txStatus(tx),
          hash: tx.hash,
          comment: neutralizeComment(body.comment),
          isScam: false,
          isBounce: body.isBounce,
        });
      } else if (body.jettonAmountRaw !== null && body.destination !== null) {
        const master = walletToMaster.get(outMsg.source?.toLowerCase() ?? '');
        const meta = master ? (metadata[master] ?? null) : null;
        items.push({
          id: `${tx.hash}:${tx.lt}:jout:${String(index)}`,
          direction: 'out',
          standard: 'jetton',
          symbol: meta?.symbol ?? 'JETTON',
          decimals: meta?.decimals ?? 9,
          amountRaw: body.jettonAmountRaw,
          amount: formatDecimal(body.jettonAmountRaw, meta?.decimals ?? 9),
          counterparty: friendly(body.destination, response.addressBook),
          timestamp: tx.now,
          ...fee(tx),
          status: txStatus(tx),
          hash: tx.hash,
          comment: null,
          isScam: meta?.isScam ?? false,
        });
      }
    });
  }
  return filterActivity(items);
}

export function mapTonApiActivity(events: TonApiEvent[]): TonActivityItem[] {
  const items: TonActivityItem[] = [];
  for (const event of events) {
    event.transfers.forEach((transfer, index) => {
      items.push({
        id: `${event.eventId}:${String(index)}`,
        direction: transfer.direction,
        standard: transfer.standard,
        symbol: transfer.symbol ?? (transfer.standard === 'native' ? NATIVE_TON.symbol : 'JETTON'),
        decimals: transfer.decimals ?? NATIVE_TON.decimals,
        amountRaw: transfer.amountRaw,
        amount: formatDecimal(transfer.amountRaw, transfer.decimals ?? NATIVE_TON.decimals),
        counterparty: transfer.counterparty,
        timestamp: event.timestamp,
        feeRaw: '0',
        fee: '0',
        status: event.status,
        hash: event.hash,
        comment: neutralizeComment(transfer.comment),
        isScam: transfer.isScam,
        isBounce: transfer.isBounce,
      });
    });
  }
  return filterActivity(items);
}
