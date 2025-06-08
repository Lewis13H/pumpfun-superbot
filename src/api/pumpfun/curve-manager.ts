// src/api/pumpfun/curve-manager.ts
import { PublicKey } from '@solana/web3.js';
import { logger } from '../../utils/logger2';
import { getRateLimitedConnection } from '../../utils/rpc-rate-limiter';
import type { RateLimitedConnection } from '../../utils/rpc-rate-limiter';

// Constants from pump.fun
const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_DECIMALS = 6;
const CURVE_TOKEN_DECIMALS = 10 ** TOKEN_DECIMALS;

// Bonding curve state interface
export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  
  // Calculated values
  current_price: number; // Price in SOL per token
  marketCapSol: number;
  solReserves: number; // Real SOL reserves in SOL
  tokenReserves: number; // Real token reserves
  totalSupply: number;
  progress: number; // Progress to Raydium migration (0-100)
  solPriceUSD: number; // Current SOL price in USD
}

export class BondingCurveManager {
  private solPriceUSD: number = 180; // Default SOL current_price, should be updated
  private connection: RateLimitedConnection;

  constructor() {
    this.connection = getRateLimitedConnection();
    logger.info('BondingCurveManager initialized with rate-limited connection');
  }

  async getCurveState(bondingCurveAddress: string): Promise<BondingCurveState | null> {
    try {
      const bondingCurve = new PublicKey(bondingCurveAddress);
      const accountInfo = await this.connection.getAccountInfo(bondingCurve);

      if (!accountInfo || !accountInfo.data) {
        logger.error(`No account data found for bonding curve: ${bondingCurveAddress}`);
        return null;
      }

      // Parse the bonding curve data
      const data = accountInfo.data;
      
      // Pump.fun bonding curve layout (adjust based on actual structure)
      const virtualTokenReserves = data.readBigUInt64LE(8);
      const virtualSolReserves = data.readBigUInt64LE(16);
      const realTokenReserves = data.readBigUInt64LE(24);
      const realSolReserves = data.readBigUInt64LE(32);
      const tokenTotalSupply = data.readBigUInt64LE(40);
      const complete = data.readUInt8(48) === 1;

      // Calculate derived values
      const current_price = this.calculatePrice(virtualSolReserves, virtualTokenReserves);
      const marketCapSol = this.calculateMarketCap(tokenTotalSupply, current_price);
      const progress = this.calculateProgress(realSolReserves);

      return {
        virtualTokenReserves,
        virtualSolReserves,
        realTokenReserves,
        realSolReserves,
        tokenTotalSupply,
        complete,
        current_price,
        marketCapSol,
        solReserves: Number(realSolReserves) / LAMPORTS_PER_SOL,
        tokenReserves: Number(realTokenReserves) / CURVE_TOKEN_DECIMALS,
        totalSupply: Number(tokenTotalSupply) / CURVE_TOKEN_DECIMALS,
        progress,
        solPriceUSD: this.solPriceUSD
      };
    } catch (error) {
      logger.error('Error fetching bonding curve state:', error);
      return null;
    }
  }

  private calculatePrice(virtualSolReserves: bigint, virtualTokenReserves: bigint): number {
      if (virtualTokenReserves === 0n) return 0;
    
      // Convert reserves to decimal values
      const solReserves = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
      const tokenReserves = Number(virtualTokenReserves) / CURVE_TOKEN_DECIMALS;
    
      if (tokenReserves === 0) return 0;
    
      // Price = SOL reserves / token reserves
      return solReserves / tokenReserves;
  }

  private calculateMarketCap(totalSupply: bigint, priceInSol: number): number {
      // Convert total supply to decimal tokens
      const totalSupplyDecimal = Number(totalSupply) / CURVE_TOKEN_DECIMALS;
    
      // Market cap in SOL = total supply * price per token
      return totalSupplyDecimal * priceInSol;
  }

  private calculateProgress(realSolReserves: bigint): number {
    // Pump.fun typically migrates at 85 SOL
    const MIGRATION_THRESHOLD = 85 * LAMPORTS_PER_SOL;
    const progress = (Number(realSolReserves) / MIGRATION_THRESHOLD) * 100;
    return Math.min(progress, 100);
  }

  async updateSolPrice(price: number): Promise<void> {
    this.solPriceUSD = price;
    logger.debug(`Updated SOL price to $${price}`);
  }

  getGraduationThreshold(): { sol: number; usd: number } {
    const solThreshold = 85; // 85 SOL for Raydium migration
    return {
      sol: solThreshold,
      usd: solThreshold * this.solPriceUSD
    };
  }

  estimateTokensForSol(bondingCurveAddress: string, solAmount: number): number {
    // Simplified calculation - should use actual bonding curve math
    // This is a placeholder - implement actual pump.fun curve calculations
    return solAmount * 1000000; // Placeholder
  }
}









