// src/utils/address-validator.ts
import { PublicKey } from '@solana/web3.js';
import { logger } from './logger2';

export class AddressValidator {
  /**
   * Validates if a string is a valid Solana address
   */
  static isValidAddress(address: string): boolean {
    try {
      // Check basic format
      if (!address || typeof address !== 'string') {
        return false;
      }

      // Check length (should be 32-44 characters for base58)
      if (address.length < 32 || address.length > 44) {
        return false;
      }

      // Check for invalid characters (Solana uses base58, no 0, O, I, or l)
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
      if (!base58Regex.test(address)) {
        return false;
      }

      // Try to create a PublicKey object - this is the definitive test
      new PublicKey(address);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Sanitizes token discovery data
   */
  static sanitizeTokenData(token: any): any | null {
    // Validate address
    if (!this.isValidAddress(token.address)) {
      logger.warn(`Invalid token address rejected: ${token.address} (${token.symbol})`);
      return null;
    }

    // Clean up symbol and name
    const sanitized = {
      ...token,
      symbol: this.sanitizeString(token.symbol, 20),
      name: this.sanitizeString(token.name, 100),
    };

    return sanitized;
  }

  /**
   * Sanitizes a string field
   */
  private static sanitizeString(value: any, maxLength: number): string {
    if (!value || typeof value !== 'string') {
      return 'UNKNOWN';
    }

    // Remove any non-printable characters and trim
    const cleaned = value
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
      .trim()
      .substring(0, maxLength);

    return cleaned || 'UNKNOWN';
  }

  /**
   * Batch validate addresses
   */
  static validateBatch(addresses: string[]): {
    valid: string[];
    invalid: { address: string; reason: string }[];
  } {
    const valid: string[] = [];
    const invalid: { address: string; reason: string }[] = [];

    for (const address of addresses) {
      if (this.isValidAddress(address)) {
        valid.push(address);
      } else {
        let reason = 'Unknown error';
        
        if (!address) {
          reason = 'Empty address';
        } else if (address.length < 32 || address.length > 44) {
          reason = `Invalid length: ${address.length}`;
        } else if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
          reason = 'Contains invalid characters';
        } else {
          reason = 'Failed PublicKey validation';
        }

        invalid.push({ address, reason });
      }
    }

    return { valid, invalid };
  }
}
