/** Browser Buffer polyfill for @ton/core and @ton/ton (MIT `buffer`, same as Node's). */
import { Buffer as NodeBuffer } from 'buffer';

const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof NodeBuffer };
if (typeof globalWithBuffer.Buffer === 'undefined') {
  globalWithBuffer.Buffer = NodeBuffer;
}

export {};
