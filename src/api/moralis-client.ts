import { BaseAPIClient } from './base-api-client';

export interface MoralisHolderData {
  address: string;
  balance: string;
  percentage: number;
  isContract: boolean;
  firstSeen: Date;
  lastActivity: Date;
}

export class MoralisClient extends BaseAPIClient {
  constructor(apiKey: string) {
    super('moralis', 'https://solana-gateway.moralis.io', apiKey);
  }

  async getTokenHolders(tokenAddress: string, limit: number = 100): Promise<MoralisHolderData[]> {
    const data = await this.makeRequest<any>(
      `/token/${tokenAddress}/owners`,
      {
        method: 'GET',
        params: { limit },
        headers: { 'X-API-Key': this.apiKey }
      },
      0.01 // Estimated $0.01 per call
    );

    return (data.result || []).map((holder: any) => ({
      address: holder.owner_address,
      balance: holder.amount,
      percentage: holder.percentage || 0,
      isContract: holder.is_contract || false,
      firstSeen: new Date(holder.first_seen_at || Date.now()),
      lastActivity: new Date(holder.last_activity_at || Date.now())
    }));
  }

  async getServiceStatus(): Promise<boolean> {
    try {
      await this.makeRequest('/info/health', { 
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey }
      }, 0);
      return true;
    } catch {
      return false;
    }
  }
}

