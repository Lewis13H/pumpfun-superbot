export interface Token {
  address: string;
  symbol: string;
  name: string;
  platform: string;
  age: string;
  liquidity: number;
  marketCap: number;
  graduationProgress: number;
  holders: number;
  smartMoneyHolders: number;
  transactions1m: number;
  volume1m: number;
  price: number;
  priceChange: {
    '1m': number;
    '5m': number;
    '1h': number;
    '24h': number;
  };
  securityScore: number;
  badges: string[];
  riskLevel: string;
}

export interface DiscoveryStats {
  isRunning: boolean;
  discovery: {
    totalDiscovered: number;
    duplicatesFound: number;
    errorsEncountered: number;
    monitorsActive: number;
    uniqueTokens: number;
  };
  processing: {
    processed: number;
    failed: number;
    skipped: number;
    queueSize: number;
  };
  marketAnalysis: {
    isRunning: boolean;
    tokensMonitored: number;
  };
  timestamp: string;
  uptime: number;
}

export interface SystemHealth {
  status: string;
  timestamp: string;
  uptime: number;
  environment: string;
}