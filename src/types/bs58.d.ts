declare module 'bs58' {
  function encode(buffer: Buffer | Uint8Array | number[]): string;
  function decode(string: string): Buffer;
  export { encode, decode };
}
