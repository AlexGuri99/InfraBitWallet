/** Publicly known TEST mnemonics. Never use for real funds. */

/** BIP-39 vector 0 mnemonic (128-bit zero entropy): 11 x "abandon" + "about". */
export const MNEMONIC_12_ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** BIP-39 vector 8 mnemonic (256-bit zero entropy): 23 x "abandon" + "art". */
export const MNEMONIC_24_ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

/** Hardhat default mnemonic: https://v2.hardhat.org/hardhat-network/docs/reference */
export const MNEMONIC_12_HARDHAT = 'test test test test test test test test test test test junk';

/** First Hardhat account (m/44'/60'/0'/0/0), EIP-55 form as published. */
export const HARDHAT_FIRST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
