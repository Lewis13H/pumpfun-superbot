// src/utils/token-v2-calculator.ts

import { bondingCurveCalculator } from './pumpfun-bonding-curve';
import { SOL_PRICE_SERVICE } from '../services/sol-price-service';

export interface TokenV2Data {
  tokens_sold: number;
  tokens_remaining: number;
  sol_in_curve: number;
  sol_price_at_update: number;
  current_price_sol: number;
  current_price_usd: number;
}

export function calculateTokenV2Data(
  marketCapUSD: number,
  pricePerToken?: number
): TokenV2Data {
  const solPrice = SOL_PRICE_SERVICE.getPrice() || 180;;
  
  // Calculate progress from market cap (exponential curve)
  // Your curve: $4k to $69k range
  const progress = Math.max(0, Math.min(1,
    (marketCapUSD - 4000) / (69000 - 4000)
  ));
  
  // Tokens sold (out of 800M on curve)
  const tokensSold = progress * 800_000_000;
  const tokensRemaining = 800_000_000 - tokensSold;
  
  // SOL in curve (total raised is $12k)
  const usdRaised = progress * 12000;
  const solInCurve = usdRaised / solPrice;
  
  // Price calculations
  let currentPriceSOL = 0;
  let currentPriceUSD = 0;
  
  if (pricePerToken) {
    currentPriceSOL = pricePerToken;
    currentPriceUSD = pricePerToken * solPrice;
  } else {
    // Calculate from market cap
    currentPriceUSD = marketCapUSD / 1_000_000_000; // Price per token
    currentPriceSOL = currentPriceUSD / solPrice;
  }
  
  return {
    tokens_sold: tokensSold,
    tokens_remaining: tokensRemaining,
    sol_in_curve: solInCurve,
    sol_price_at_update: solPrice,
    current_price_sol: currentPriceSOL,
    current_price_usd: currentPriceUSD
  };
}

