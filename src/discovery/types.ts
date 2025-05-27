export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals?: number;
  supply?: string;
  metadata?: any;
}

export interface PumpFunToken {
  mint: string;
  symbol: string;
  name: string;
  description?: string;
  image_uri?: string;
  created_timestamp: number;
  creator: string;
  usd_market_cap?: number;
  bonding_curve?: string;
}

export interface DiscoveryEvent {
  type: 'discovered' | 'updated' | 'error';
  platform: string;
  token: TokenInfo;
  timestamp: Date;
}