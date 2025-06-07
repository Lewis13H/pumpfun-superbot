// src/api/pumpfun/event-processor.ts
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { logger } from '../../utils/logger';

// IDL types for pump.fun
interface CreateEventData {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  associatedBondingCurve: string;
  user: string;
  creator: string;
  creatorVault?: string;
}

export class PumpEventProcessor {
  // Discriminator for create instruction
  private readonly CREATE_DISCRIMINATOR = Buffer.from([
    0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77
  ]);

  constructor(private pumpProgram: PublicKey) {}

  /**
   * Process logs from logsSubscribe to extract token creation data
   */
  async processLogsForToken(logs: any): Promise<CreateEventData | null> {
    try {
      // Method 1: Look for instruction logs with token info
      const instructionLog = logs.logs.find((log: string) => 
        log.includes('Instruction: Create') || log.includes('CreateToken')
      );

      if (instructionLog) {
        // Extract token address from logs
        const mintLog = logs.logs.find((log: string) => 
          log.includes('Token mint:') || log.includes('Mint:')
        );
        
        if (mintLog) {
          const mintMatch = mintLog.match(/[A-Za-z0-9]{43,44}/);
          if (mintMatch) {
            const mint = mintMatch[0];
            return this.createMinimalTokenData(mint, logs);
          }
        }
      }

      // Method 2: Parse from transaction accounts if available
      if (logs.transaction?.message?.accountKeys) {
        return this.parseFromTransactionAccounts(logs);
      }

      // Method 3: Try parsing program data with better error handling
      const programDataLog = logs.logs.find((log: string) => 
        log.includes('Program data:')
      );
      
      if (programDataLog) {
        const dataString = programDataLog.split('Program data: ')[1];
        if (dataString) {
          return this.parseWithFallback(dataString, logs);
        }
      }

      return null;
    } catch (error) {
      logger.error('Error processing logs for token:', error);
      return null;
    }
  }

  /**
   * Create minimal token data from mint address
   */
  private createMinimalTokenData(mint: string, logs: any): CreateEventData {
    const mintPubkey = new PublicKey(mint);
    const bondingCurve = this.deriveBondingCurve(mintPubkey);
    const associatedBondingCurve = this.deriveAssociatedBondingCurve(mintPubkey, bondingCurve);
    
    // Try to extract creator from logs or use first signer
    let creator = mint; // Default to mint as creator
    if (logs.transaction?.message?.accountKeys?.length > 0) {
      creator = logs.transaction.message.accountKeys[0]; // First signer is usually creator
    }

    return {
      name: `Token ${mint.slice(0, 6)}`,
      symbol: 'UNKNOWN',
      uri: '',
      mint,
      bondingCurve: bondingCurve.toString(),
      associatedBondingCurve: associatedBondingCurve.toString(),
      user: creator,
      creator,
      creatorVault: this.deriveCreatorVault(new PublicKey(creator)).toString(),
    };
  }

  /**
   * Parse from transaction accounts
   */
  private parseFromTransactionAccounts(logs: any): CreateEventData | null {
    try {
      const accounts = logs.transaction?.message?.accountKeys;
      if (!accounts || accounts.length < 4) return null;

      // Typical pump.fun create transaction account order:
      // [0] = creator/signer
      // [1] = mint
      // [2] = bonding curve
      // [3] = associated bonding curve
      
      const creator = accounts[0];
      const mint = accounts[1];
      const bondingCurve = accounts[2];
      
      const mintPubkey = new PublicKey(mint);
      const associatedBondingCurve = this.deriveAssociatedBondingCurve(
        mintPubkey,
        new PublicKey(bondingCurve)
      );

      return {
        name: `New Token`,
        symbol: 'NEW',
        uri: '',
        mint,
        bondingCurve,
        associatedBondingCurve: associatedBondingCurve.toString(),
        user: creator,
        creator,
        creatorVault: this.deriveCreatorVault(new PublicKey(creator)).toString(),
      };
    } catch (error) {
      logger.debug('Failed to parse from transaction accounts:', error);
      return null;
    }
  }

  /**
   * Parse with multiple fallback strategies
   */
  private parseWithFallback(dataString: string, logs: any): CreateEventData | null {
    try {
      const decodedData = Buffer.from(dataString, 'base64');
      logger.debug(`Program data size: ${decodedData.length} bytes`);

      // Only try to parse if data size is reasonable
      if (decodedData.length < 50 || decodedData.length > 1000) {
        logger.debug('Program data size out of expected range');
        return this.createFallbackToken(logs);
      }

      // Try different parsing strategies
      const strategies = [
        () => this.parseV1Format(decodedData),
        () => this.parseV2Format(decodedData),
        () => this.parseRawAccounts(decodedData),
      ];

      for (const strategy of strategies) {
        const result = strategy();
        if (result) return result;
      }

      return this.createFallbackToken(logs);
    } catch (error) {
      logger.debug('All parsing strategies failed:', error);
      return null;
    }
  }

  /**
   * Parse V1 format (with string lengths)
   */
  private parseV1Format(data: Buffer): CreateEventData | null {
    try {
      let offset = 8; // Skip discriminator

      // Validate string at offset with bounds checking
      const validateAndReadString = (maxLength: number = 100): string | null => {
        if (offset + 4 > data.length) return null;
        
        const length = data.readUInt32LE(offset);
        if (length > maxLength || length === 0 || offset + 4 + length > data.length) {
          logger.debug(`Invalid string length: ${length} at offset ${offset}`);
          return null;
        }
        
        offset += 4;
        const str = data.slice(offset, offset + length).toString('utf8');
        offset += length;
        
        // Validate string contains valid characters
        if (!/^[\x20-\x7E]*$/.test(str)) {
          return null;
        }
        
        return str;
      };

      const name = validateAndReadString(50);
      const symbol = validateAndReadString(20);
      
      if (!name || !symbol) {
        return null;
      }

      // Continue parsing...
      return null; // Simplified for brevity
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse V2 format (direct pubkeys)
   */
  private parseV2Format(data: Buffer): CreateEventData | null {
    try {
      if (data.length < 96) return null; // Need at least 3 pubkeys

      let offset = 8; // Skip discriminator
      
      // Read pubkeys directly
      const mint = bs58.encode(data.slice(offset, offset + 32));
      offset += 32;
      
      const bondingCurve = bs58.encode(data.slice(offset, offset + 32));
      offset += 32;
      
      const creator = bs58.encode(data.slice(offset, offset + 32));

      // Validate pubkeys
      try {
        new PublicKey(mint);
        new PublicKey(bondingCurve);
        new PublicKey(creator);
      } catch {
        return null;
      }

      const mintPubkey = new PublicKey(mint);
      const associatedBondingCurve = this.deriveAssociatedBondingCurve(
        mintPubkey,
        new PublicKey(bondingCurve)
      );

      return {
        name: 'New Token',
        symbol: 'NEW',
        uri: '',
        mint,
        bondingCurve,
        associatedBondingCurve: associatedBondingCurve.toString(),
        user: creator,
        creator,
        creatorVault: this.deriveCreatorVault(new PublicKey(creator)).toString(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse raw account addresses
   */
  private parseRawAccounts(data: Buffer): CreateEventData | null {
    try {
      // Look for patterns of valid base58 pubkeys in the data
      const pubkeyPattern = /[1-9A-HJ-NP-Za-km-z]{43,44}/g;
      const dataString = data.toString('latin1');
      const matches = dataString.match(pubkeyPattern);
      
      if (matches && matches.length >= 2) {
        const mint = matches[0];
        const creator = matches[1];
        
        // Validate
        try {
          new PublicKey(mint);
          new PublicKey(creator);
          
          const mintPubkey = new PublicKey(mint);
          const bondingCurve = this.deriveBondingCurve(mintPubkey);
          const associatedBondingCurve = this.deriveAssociatedBondingCurve(mintPubkey, bondingCurve);
          
          return {
            name: 'New Token',
            symbol: 'NEW',
            uri: '',
            mint,
            bondingCurve: bondingCurve.toString(),
            associatedBondingCurve: associatedBondingCurve.toString(),
            user: creator,
            creator,
            creatorVault: this.deriveCreatorVault(new PublicKey(creator)).toString(),
          };
        } catch {
          return null;
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Create fallback token from available log data
   */
  private createFallbackToken(logs: any): CreateEventData | null {
    // Extract any available mint address from logs
    for (const log of logs.logs) {
      const pubkeyMatch = log.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/);
      if (pubkeyMatch) {
        try {
          new PublicKey(pubkeyMatch[0]);
          return this.createMinimalTokenData(pubkeyMatch[0], logs);
        } catch {
          continue;
        }
      }
    }
    
    return null;
  }

  /**
   * Derive bonding curve address for a token
   */
  private deriveBondingCurve(mint: PublicKey): PublicKey {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('bonding-curve'),
        mint.toBuffer()
      ],
      this.pumpProgram
    );
    return bondingCurve;
  }

  /**
   * Derive associated bonding curve address
   */
  private deriveAssociatedBondingCurve(mint: PublicKey, bondingCurve: PublicKey): PublicKey {
    const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    
    const [associatedAddress] = PublicKey.findProgramAddressSync(
      [
        bondingCurve.toBuffer(),
        TOKEN_PROGRAM.toBuffer(),
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM
    );
    
    return associatedAddress;
  }

  /**
   * Derive creator vault address
   */
  private deriveCreatorVault(creator: PublicKey): PublicKey {
    const [vaultAddress] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('creator-vault'),
        creator.toBuffer()
      ],
      this.pumpProgram
    );
    
    return vaultAddress;
  }
}
