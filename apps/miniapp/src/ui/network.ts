/**
 * Network helpers shared by every screen. The active network comes from `/api/ton/config`, never
 * from a hardcoded constant: mainnet and testnet need different address forms, explorer URLs and
 * labels for the same key.
 */
import {
  tonAddressForNetwork,
  tonDisplayAddressForNetwork,
  type TonNetwork,
} from '@onezerowallet/chain-ton';

export interface TonConfig {
  network: TonNetwork;
  swapEnabled: boolean;
  stakingEnabled: boolean;
  swapFeeBps: number;
  referralConfigured: boolean;
}

/**
 * Safe default when the config endpoint is unreachable: testnet, swaps and staking disabled.
 * It can never cause a mainnet transaction and the read APIs fail closed on the mismatch.
 */
export const DEFAULT_TON_CONFIG: TonConfig = {
  network: 'testnet',
  swapEnabled: false,
  stakingEnabled: false,
  swapFeeBps: 0,
  referralConfigured: false,
};

/** The receive/query address for the active network (non-bounceable by default). */
export interface TonAddressForms {
  addressBounceable: string;
  addressNonBounceable: string;
  addressTestnetBounceable: string;
  addressTestnetNonBounceable: string;
}

export function activeTonAddress(
  forms: TonAddressForms,
  network: TonNetwork,
  bounceable = false,
): string {
  return tonAddressForNetwork(
    {
      bounceable: forms.addressBounceable,
      nonBounceable: forms.addressNonBounceable,
      testnetBounceable: forms.addressTestnetBounceable,
      testnetNonBounceable: forms.addressTestnetNonBounceable,
    },
    network,
    bounceable,
  );
}

/** Render a raw `0:…` address in the active network's user-friendly form. */
export function displayTonAddress(raw: string, network: TonNetwork, bounceable = true): string {
  return tonDisplayAddressForNetwork(raw, network, bounceable);
}

export function explorerBase(network: TonNetwork): string {
  return network === 'mainnet' ? 'https://tonviewer.com' : 'https://testnet.tonviewer.com';
}

export function explorerTransactionUrl(network: TonNetwork, hashHex: string): string {
  return `${explorerBase(network)}/transaction/${hashHex}`;
}

export function explorerMessageUrl(network: TonNetwork, hashHex: string): string {
  return `${explorerBase(network)}/message/${hashHex}`;
}

export function explorerHost(network: TonNetwork): string {
  return network === 'mainnet' ? 'tonviewer.com' : 'testnet.tonviewer.com';
}
