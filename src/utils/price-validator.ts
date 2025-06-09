// src/utils/price-validator.ts
import { logger } from './logger2';

export interface BondingCurveData {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface PriceValidationResult {
  isValid: boolean;
  price: number;
  warnings: string[];
  errors: string[];
}

export class PriceValidator {
  private static readonly MIN_PRICE = 1e-12; // Minimum reasonable price
  private static readonly MAX_PRICE = 1000; // Maximum reasonable price in SOL
  private static readonly MIN_RESERVES = 1000; // Minimum reserves to consider valid
  
  static validateAndCalculatePrice(
    bondingCurve: BondingCurveData,
    tokenAddress: string
  ): PriceValidationResult {
    const result: PriceValidationResult = {
      isValid: false,
      price: 0,
      warnings: [],
      errors: []
    };

    // Check if bonding curve is complete
    if (bondingCurve.complete) {
      result.errors.push('Bonding curve is complete (graduated)');
      return result;
    }

    // Validate virtual reserves exist
    if (bondingCurve.virtualTokenReserves === 0n) {
      result.errors.push('Virtual token reserves is zero');
      return result;
    }

    if (bondingCurve.virtualSolReserves === 0n) {
      result.errors.push('Virtual SOL reserves is zero');
      return result;
    }

    // Check minimum reserves threshold
    const solReservesNum = Number(bondingCurve.virtualSolReserves) / 1e9;
    const tokenReservesNum = Number(bondingCurve.virtualTokenReserves) / 1e6;

    if (solReservesNum < this.MIN_RESERVES / 1e9) {
      result.warnings.push(`Very low SOL reserves: ${solReservesNum.toFixed(6)}`);
    }

    if (tokenReservesNum < this.MIN_RESERVES) {
      result.warnings.push(`Very low token reserves: ${tokenReservesNum.toFixed(2)}`);
    }

    // Calculate price using exact Shyft formula
    const price = solReservesNum / tokenReservesNum;

    // Validate price range
    if (price < this.MIN_PRICE) {
      result.errors.push(`Price too low: ${price} (min: ${this.MIN_PRICE})`);
      return result;
    }

    if (price > this.MAX_PRICE) {
      result.errors.push(`Price too high: ${price} (max: ${this.MAX_PRICE})`);
      return result;
    }

    // Check for suspicious price patterns
    if (isNaN(price) || !isFinite(price)) {
      result.errors.push('Price calculation resulted in NaN or Infinity');
      return result;
    }

    // Validate curve progress makes sense
    const realSolReservesNum = Number(bondingCurve.realSolReserves) / 1e9;
    const graduationTarget = 85; // 85 SOL for graduation
    
    if (realSolReservesNum > graduationTarget) {
      result.warnings.push(`Real SOL reserves (${realSolReservesNum.toFixed(2)}) exceeds graduation target`);
    }

    // Calculate market cap and validate
    const totalSupplyNum = Number(bondingCurve.tokenTotalSupply) / 1e6;
    const marketCap = price * totalSupplyNum; // In SOL

    if (marketCap > 1000000) { // > 1M SOL market cap
      result.warnings.push(`Very high market cap: ${marketCap.toFixed(0)} SOL`);
    }

    // Price seems valid
    result.isValid = true;
    result.price = price;

    // Log warnings if any
    if (result.warnings.length > 0) {
      logger.debug(`Price warnings for ${tokenAddress.substring(0, 8)}...: ${result.warnings.join(', ')}`);
    }

    return result;
  }

  /**
   * Enhanced price calculation with full validation
   */
  static calculateValidatedPrice(
    bondingCurve: BondingCurveData,
    tokenAddress: string,
    solPriceUsd: number
  ): {
    priceSol: number;
    priceUsd: number;
    marketCapUsd: number;
    liquidityUsd: number;
    curveProgress: number;
    isValid: boolean;
    warnings: string[];
  } {
    const validation = this.validateAndCalculatePrice(bondingCurve, tokenAddress);
    
    if (!validation.isValid) {
      logger.warn(`Invalid price for ${tokenAddress.substring(0, 8)}...: ${validation.errors.join(', ')}`);
      return {
        priceSol: 0,
        priceUsd: 0,
        marketCapUsd: 0,
        liquidityUsd: 0,
        curveProgress: 0,
        isValid: false,
        warnings: validation.errors
      };
    }

    const priceSol = validation.price;
    const priceUsd = priceSol * solPriceUsd;
    
    // Calculate market cap
    const totalSupplyNum = Number(bondingCurve.tokenTotalSupply) / 1e6;
    const marketCapUsd = priceUsd * totalSupplyNum;

    // Calculate liquidity (2x real SOL reserves)
    const realSolReservesNum = Number(bondingCurve.realSolReserves) / 1e9;
    const liquidityUsd = realSolReservesNum * solPriceUsd * 2;

    // Calculate curve progress
    const graduationTarget = 85 * 1e9; // 85 SOL in lamports
    const curveProgress = Math.min((Number(bondingCurve.realSolReserves) / graduationTarget) * 100, 100);

    return {
      priceSol,
      priceUsd,
      marketCapUsd,
      liquidityUsd,
      curveProgress,
      isValid: true,
      warnings: validation.warnings
    };
  }
}