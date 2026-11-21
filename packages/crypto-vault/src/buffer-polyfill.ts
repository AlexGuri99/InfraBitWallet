/**
 * Browser Buffer polyfill for @ton/core and @ton/ton.
 *
 * Both libraries use Node's global `Buffer` in functions (Address.toString, Cell BOC
 * serialization, WalletContractV5R1.create). Vite/esbuild do not inject Node globals, so the
 * vault bundle in a browser would throw `Buffer is not defined`. `buffer` is the standard
 * userland implementation (MIT, same code Node exposes).
 *
 * Imported first from address.ts so the global exists before any @ton call.
 */
import { Buffer as NodeBuffer } from 'buffer';

const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof NodeBuffer };
if (typeof globalWithBuffer.Buffer === 'undefined') {
  globalWithBuffer.Buffer = NodeBuffer;
}

export {};
