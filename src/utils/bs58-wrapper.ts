// src/utils/bs58-wrapper.ts
// Wrapper to handle bs58 import issues

const bs58Module = require('bs58');

export const encode = (data: Buffer | Uint8Array): string => {
  return bs58Module.encode(data);
};

export const decode = (str: string): Buffer => {
  return bs58Module.decode(str);
};

export default {
  encode,
  decode
};
