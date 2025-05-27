// Token data from APIs
export interface TokenData {
  address: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  holders: number;
  priceChange24h?: number;
  
  // Optional fields that some APIs provide
  decimals?: number;
  supply?: number;
  logoURI?: string;
  pairs?: number;
  mainPairAddress?: string;
  dexId?: string;
  pairCreatedAt?: Date;
  lastTradeTime?: Date;
}

// Market data with trading information
export interface MarketData {
  price: number;
  marketCap: number;
  volume24h: number;
  volume1h: number;
  priceChange24h: number;
  priceChange1h: number;
  high24h: number;
  low24h: number;
}

// Holder information
export interface HolderData {
  totalHolders: number;
  top10Percentage: number;
  topHolders: HolderInfo[];
  concentration: 'low' | 'medium' | 'high' | 'extreme';
}

export interface HolderInfo {
  address: string;
  balance: number;
  percentage: number;
  rank: number;
  isCreator?: boolean;
  isOwner?: boolean;
}

// Security analysis data
export interface SecurityData {
  rugPullRisk: number; // 0-1 score
  honeypotRisk: boolean;
  mintable: boolean | null;
  freezable: boolean | null;
  lpBurned: boolean | null;
  topHolderConcentration: number;
  isVerified: boolean;
  hasWebsite: boolean;
  hasSocials: boolean;
  contractVerified: boolean;
  
  // Additional context
  ownerAddress?: string;
  creatorAddress?: string;
  mintAuthority?: string;
  freezeAuthority?: string;
  hasMinimumLiquidity?: boolean;
  isNewToken?: boolean;
}

// Liquidity information
export interface LiquidityData {
  totalLiquidityUSD: number;
  poolCount: number;
  mainPool: PoolInfo;
  pools?: PoolInfo[];
}

export interface PoolInfo {
  address: string;
  dex: string;
  liquidityUSD: number;
  volume24h: number;
}

// API client status
export interface APIClientStatus {
  name: string;
  status: 'active' | 'error' | 'not-implemented';
  requestsInWindow: number;
  rateLimitRemaining: number;
  lastError?: string;
}