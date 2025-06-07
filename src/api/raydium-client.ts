import axios from 'axios';
import { logger } from '../utils/logger';

export class RaydiumClient {
  private baseUrl = 'https://api.raydium.io/v2';
  
  async getPoolInfo(tokenAddress: string): Promise<{ liquidity: number; volume24h: number } | null> {
    try {
      // Get pool info from Raydium
      const response = await axios.get(`${this.baseUrl}/main/pool`, {
        params: {
          mint: tokenAddress
        }
      });
      
      if (response.data && response.data.data && response.data.data.length > 0) {
        const pool = response.data.data[0];
        return {
          liquidity: parseFloat(pool.liquidity || pool.tvl || '0'),
          volume24h: parseFloat(pool.volume24h || pool.volume || '0')
        };
      }
    } catch (error) {
      logger.debug(`[Raydium] No pool found for ${tokenAddress}`);
    }
    
    return null;
  }
}
