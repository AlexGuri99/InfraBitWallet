/**
 * Account type stored (and authenticated) in the seal.
 *
 * - `bip39-multichain`: the phrase is a BIP-39 mnemonic. One BIP-39 seed derives every chain:
 *   TON via SLIP-10 m/44'/607'/N', TRON m/44'/195'/N'/0/0, EVM m/44'/60'/N'/0/0.
 * - `ton-native-only`: the phrase is a TON-native 24-word mnemonic (BIP-39-style wordlist with
 *   TON's own "TON seed version" check). It only produces a TON Ed25519 key via
 *   @ton/crypto mnemonicToPrivateKey; no TRON/EVM accounts exist.
 *
 * These are NOT interchangeable: the same words produce different keys under BIP-39 and under
 * the TON-native derivation (different PBKDF2 salts). See docs/DECISIONS.md.
 */
export type AccountType = 'bip39-multichain' | 'ton-native-only';

export const DEFAULT_ACCOUNT_TYPE: AccountType = 'bip39-multichain';

export function isAccountType(value: unknown): value is AccountType {
  return value === 'bip39-multichain' || value === 'ton-native-only';
}
