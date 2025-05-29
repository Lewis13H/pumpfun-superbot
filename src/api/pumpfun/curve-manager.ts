// src/api/pumpfun/curve-manager.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../../utils/logger';

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
  price: number; // Price in SOL per token
  marketCapSol: number;
  solReserves: number; // Real SOL reserves in SOL
  tokenReserves: number; // Real token reserves
  totalSupply: number;
  progress: number; // Progress to Raydium migration (0-100)
  solPriceUSD: number; // Current SOL price in USD
}

export class BondingCurveManager {
  private solPriceUSD: number = 180; // Default SOL price, should be updated
  private readonly RAYDIUM_MIGRATION_THRESHOLD = 69420 * LAMPORTS_PER_SOL; // 69,420 SOL

  constructor(private connection: Connection) {
    // Start periodic SOL price updates
    this.updateSolPrice();
    setInterval(() => this.updateSolPrice(), 60000); // Update every minute
  }

  /**
   * Get bonding curve state and calculate price
   */
  async getCurveState(bondingCurveAddress: string): Promise<BondingCurveState> {
    try {
      const bondingCurve = new PublicKey(bondingCurveAddress);
      const accountInfo = await this.connection.getAccountInfo(bondingCurve);

      if (!accountInfo || !accountInfo.data) {
        // Account might not exist yet for very new tokens
        // Return default values instead of throwing
        logger.debug(`Bonding curve account not found yet: ${bondingCurveAddress}`);
        
        return {
          virtualTokenReserves: BigInt(1_000_000_000 * 1_000_000), // 1B tokens (typical initial supply)
          virtualSolReserves: BigInt(30 * 1_000_000_000), // 30 SOL (typical initial)
          realTokenReserves: BigInt(0),
          realSolReserves: BigInt(0),
          tokenTotalSupply: BigInt(1_000_000_000 * 1_000_000),
          complete: false,
          price: 0.00003, // Typical initial price
          marketCapSol: 30,
          solReserves: 0,
          tokenReserves: 0,
          totalSupply: 1_000_000_000,
          progress: 0,
          solPriceUSD: this.solPriceUSD,
        };
      }

      // Parse bonding curve data
      const curveData = this.parseBondingCurveData(accountInfo.data);
      
      // Calculate derived values
      const price = this.calculatePrice(curveData);
      const progress = this.calculateProgress(curveData);
      
      return {
        ...curveData,
        price,
        marketCapSol: price * (Number(curveData.tokenTotalSupply) / CURVE_TOKEN_DECIMALS),
        solReserves: Number(curveData.realSolReserves) / LAMPORTS_PER_SOL,
        tokenReserves: Number(curveData.realTokenReserves) / CURVE_TOKEN_DECIMALS,
        totalSupply: Number(curveData.tokenTotalSupply) / CURVE_TOKEN_DECIMALS,
        progress,
        solPriceUSD: this.solPriceUSD,
      };
    } catch (error) {
      logger.error('Error fetching bonding curve state:', error);
      
      // Return default values for error cases
      return {
        virtualTokenReserves: BigInt(1_000_000_000 * 1_000_000),
        virtualSolReserves: BigInt(30 * 1_000_000_000),
        realTokenReserves: BigInt(0),
        realSolReserves: BigInt(0),
        tokenTotalSupply: BigInt(1_000_000_000 * 1_000_000),
        complete: false,
        price: 0.00003,
        marketCapSol: 30,
        solReserves: 0,
        tokenReserves: 0,
        totalSupply: 1_000_000_000,
        progress: 0,
        solPriceUSD: this.solPriceUSD,
      };
    }
  }

  /**
   * Parse bonding curve account data
   * Based on pump.fun's bonding curve structure
   */
  private parseBondingCurveData(data: Buffer): Omit<BondingCurveState, 'price' | 'marketCapSol' | 'solReserves' | 'tokenReserves' | 'totalSupply' | 'progress' | 'solPriceUSD'> {
    // Skip discriminator (8 bytes)
    let offset = 8;

    // Read virtual token reserves (u64)
    const virtualTokenReserves = data.readBigUInt64LE(offset);
    offset += 8;

    // Read virtual SOL reserves (u64)
    const virtualSolReserves = data.readBigUInt64LE(offset);
    offset += 8;

    // Read real token reserves (u64)
    const realTokenReserves = data.readBigUInt64LE(offset);
    offset += 8;

    // Read real SOL reserves (u64)
    const realSolReserves = data.readBigUInt64LE(offset);
    offset += 8;

    // Read token total supply (u64)
    const tokenTotalSupply = data.readBigUInt64LE(offset);
    offset += 8;

    // Read complete flag (bool)
    const complete = data[offset] === 1;

    return {
      virtualTokenReserves,
      virtualSolReserves,
      realTokenReserves,
      realSolReserves,
      tokenTotalSupply,
      complete,
    };
  }

  /**
   * Calculate token price from bonding curve reserves
   * Using constant product formula: k = x * y
   */
  private calculatePrice(curveData: Omit<BondingCurveState, 'price' | 'marketCapSol' | 'solReserves' | 'tokenReserves' | 'totalSupply' | 'progress' | 'solPriceUSD'>): number {
    if (curveData.virtualTokenReserves === 0n) {
      return 0;
    }

    // Price = virtual SOL reserves / virtual token reserves
    const price = Number(curveData.virtualSolReserves) / Number(curveData.virtualTokenReserves);
    
    // Convert to SOL per token (accounting for decimals)
    return price * CURVE_TOKEN_DECIMALS / LAMPORTS_PER_SOL;
  }

  /**
   * Calculate progress towards Raydium migration
   */
  private calculateProgress(curveData: Omit<BondingCurveState, 'price' | 'marketCapSol' | 'solReserves' | 'tokenReserves' | 'totalSupply' | 'progress' | 'solPriceUSD'>): number {
    const currentSol = Number(curveData.realSolReserves);
    const progress = (currentSol / this.RAYDIUM_MIGRATION_THRESHOLD) * 100;
    return Math.min(progress, 100);
  }

  /**
   * Calculate token amount for a given SOL amount
   */
  calculateTokenAmount(solAmount: number, curveState: BondingCurveState): number {
    const solLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
    
    // Calculate using constant product formula
    const k = curveState.virtualTokenReserves * curveState.virtualSolReserves;
    const newSolReserves = curveState.virtualSolReserves + solLamports;
    const newTokenReserves = k / newSolReserves;
    const tokenAmount = curveState.virtualTokenReserves - newTokenReserves;
    
    return Number(tokenAmount) / CURVE_TOKEN_DECIMALS;
  }

  /**
   * Calculate SOL amount for selling tokens
   */
  calculateSolAmount(tokenAmount: number, curveState: BondingCurveState): number {
    const tokenLamports = BigInt(Math.floor(tokenAmount * CURVE_TOKEN_DECIMALS));
    
    // Calculate using constant product formula
    const k = curveState.virtualTokenReserves * curveState.virtualSolReserves;
    const newTokenReserves = curveState.virtualTokenReserves + tokenLamports;
    const newSolReserves = k / newTokenReserves;
    const solAmount = curveState.virtualSolReserves - newSolReserves;
    
    return Number(solAmount) / LAMPORTS_PER_SOL;
  }

  /**
   * Update SOL price from external source
   */
  private async updateSolPrice(): Promise<void> {
    try {
      // You can integrate with your price feed here
      // For now, using a placeholder
      // const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      // this.solPriceUSD = response.data.solana.usd;
      
      this.solPriceUSD = 180; // Placeholder - update this with real price feed
    } catch (error) {
      logger.error('Error updating SOL price:', error);
    }
  }

  /**
   * Check if a token is close to Raydium migration
   */
  isNearMigration(curveState: BondingCurveState, threshold: number = 90): boolean {
    return curveState.progress >= threshold;
  }

  /**
   * Get formatted price info for display
   */
  getFormattedPriceInfo(curveState: BondingCurveState): {
    priceSOL: string;
    priceUSD: string;
    marketCapSOL: string;
    marketCapUSD: string;
    liquidity: string;
    progress: string;
  } {
    const priceUSD = curveState.price * this.solPriceUSD;
    const marketCapUSD = curveState.marketCapSol * this.solPriceUSD;
    
    return {
      priceSOL: `${curveState.price.toFixed(8)} SOL`,
      priceUSD: `$${priceUSD.toFixed(6)}`,
      marketCapSOL: `${curveState.marketCapSol.toFixed(2)} SOL`,
      marketCapUSD: `$${marketCapUSD.toFixed(2)}`,
      liquidity: `${curveState.solReserves.toFixed(2)} SOL`,
      progress: `${curveState.progress.toFixed(1)}%`,
    };
  }
}