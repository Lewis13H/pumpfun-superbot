// src/services/dual-address-db-service.ts
import { Knex } from 'knex';
import { logger } from '../utils/logger2'; // Use logger2 like your other files
import { DualAddressToken } from '../grpc/enhanced-yellowstone-client';

export interface TokenWithDualAddress {
  address: string;           // SPL address (primary key)
  splAddress: string;        // Same as address
  pumpfunAddress: string;    // Pump.fun identifier
  symbol: string;
  name: string;
  category: string;
  marketCap: number;
  currentPriceUsd: number;
  currentPriceSol: number;
  bondingCurve: string;
  updatedAt: Date;
}

export class DualAddressDbService {
  constructor(private db: Knex) {}
  
  /**
   * Insert or update token with dual addresses
   */
  async upsertTokenWithDualAddress(
    dualToken: DualAddressToken,
    additionalData?: any
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      try {
        // Calculate price from bonding curve
        const { virtualSolReserves, virtualTokenReserves } = dualToken.bondingCurveData;
        const priceSol = this.calculatePrice(virtualSolReserves, virtualTokenReserves);
        const priceUsd = priceSol * (additionalData?.solPriceUsd || 100); // Default SOL price
        
        // Calculate market cap (assuming 1B total supply for pump.fun tokens)
        const totalSupply = 1000000000; // 1 billion tokens
        const marketCap = priceUsd * totalSupply;
        
        // Upsert token with both addresses
        await trx('tokens')
          .insert({
            address: dualToken.splTokenAddress,
            pumpfun_address: dualToken.pumpfunAddress,
            bonding_curve: dualToken.pumpfunAddress,
            symbol: 'LOADING...',
            name: 'Loading...',
            current_price_sol: priceSol,
            current_price_usd: priceUsd,
            market_cap: marketCap,
            last_price_update: dualToken.timestamp,
            category: this.determineCategory(marketCap),
            created_at: dualToken.timestamp,
            updated_at: dualToken.timestamp
          })
          .onConflict('address')
          .merge({
            pumpfun_address: dualToken.pumpfunAddress,
            bonding_curve: dualToken.pumpfunAddress,
            current_price_sol: priceSol,
            current_price_usd: priceUsd,
            market_cap: marketCap,
            last_price_update: dualToken.timestamp,
            updated_at: new Date()
          });
        
        // Insert price history
        await trx('timeseries.token_prices')
          .insert({
            token_address: dualToken.splTokenAddress,
            time: dualToken.timestamp,
            price_sol: priceSol,
            price_usd: priceUsd,
            virtual_sol_reserves: dualToken.bondingCurveData.virtualSolReserves,
            virtual_token_reserves: dualToken.bondingCurveData.virtualTokenReserves,
            real_sol_reserves: dualToken.bondingCurveData.realSolReserves,
            real_token_reserves: dualToken.bondingCurveData.realTokenReserves,
            market_cap: marketCap,
            liquidity_usd: Number(dualToken.bondingCurveData.realSolReserves) / 1e9 * (additionalData?.solPriceUsd || 100) * 2,
            slot: dualToken.slot.toString(),
            source: 'grpc'
          })
          .onConflict(['token_address', 'time'])
          .ignore();
        
        logger.debug(`✅ Stored dual address token: SPL=${dualToken.splTokenAddress.substring(0, 8)}..., Pump=${dualToken.pumpfunAddress.substring(0, 8)}...`);
        
      } catch (error) {
        logger.error('Failed to upsert dual address token:', error);
        throw error;
      }
    });
  }
  
  /**
   * Universal token lookup by any address type
   */
  async getTokenByAnyAddress(address: string): Promise<TokenWithDualAddress | null> {
    try {
      // First try direct query
      const token = await this.db('tokens')
        .where('address', address)
        .orWhere('pumpfun_address', address)
        .first();
      
      if (!token) {
        return null;
      }
      
      return {
        address: token.address,
        splAddress: token.address,
        pumpfunAddress: token.pumpfun_address || token.bonding_curve || '',
        symbol: token.symbol || 'LOADING...',
        name: token.name || 'Loading...',
        category: token.category || 'NEW',
        marketCap: parseFloat(token.market_cap || '0'),
        currentPriceUsd: parseFloat(token.current_price_usd || '0'),
        currentPriceSol: parseFloat(token.current_price_sol || '0'),
        bondingCurve: token.pumpfun_address || token.bonding_curve || '',
        updatedAt: token.updated_at
      };
    } catch (error) {
      logger.error(`Error getting token by address ${address}:`, error);
      return null;
    }
  }
  
  /**
   * Get address pair for any input address
   */
  async getAddressPair(address: string): Promise<{ spl: string; pumpfun: string } | null> {
    try {
      // First check token_address_mapping table if it exists
      const mappingExists = await this.db.schema.hasTable('token_address_mapping');
      
      if (mappingExists) {
        const mapping = await this.db('token_address_mapping')
          .where('spl_address', address)
          .orWhere('pumpfun_address', address)
          .first();
        
        if (mapping) {
          return {
            spl: mapping.spl_address,
            pumpfun: mapping.pumpfun_address
          };
        }
      }
      
      // Fallback to tokens table
      const token = await this.db('tokens')
        .where('address', address)
        .orWhere('pumpfun_address', address)
        .first();
      
      if (token && token.pumpfun_address) {
        return {
          spl: token.address,
          pumpfun: token.pumpfun_address
        };
      }
      
      return null;
    } catch (error) {
      logger.error(`Error getting address pair for ${address}:`, error);
      return null;
    }
  }
  
  /**
   * Batch lookup multiple addresses
   */
  async getTokensByAnyAddresses(addresses: string[]): Promise<Map<string, TokenWithDualAddress>> {
    try {
      const tokens = await this.db('tokens')
        .whereIn('address', addresses)
        .orWhereIn('pumpfun_address', addresses);
      
      const tokenMap = new Map<string, TokenWithDualAddress>();
      
      for (const row of tokens) {
        const token: TokenWithDualAddress = {
          address: row.address,
          splAddress: row.address,
          pumpfunAddress: row.pumpfun_address || row.bonding_curve || '',
          symbol: row.symbol || 'LOADING...',
          name: row.name || 'Loading...',
          category: row.category || 'NEW',
          marketCap: parseFloat(row.market_cap || '0'),
          currentPriceUsd: parseFloat(row.current_price_usd || '0'),
          currentPriceSol: parseFloat(row.current_price_sol || '0'),
          bondingCurve: row.pumpfun_address || row.bonding_curve || '',
          updatedAt: row.updated_at
        };
        
        // Map by both addresses for easy lookup
        tokenMap.set(row.address, token);
        if (row.pumpfun_address) {
          tokenMap.set(row.pumpfun_address, token);
        }
      }
      
      return tokenMap;
    } catch (error) {
      logger.error('Error getting tokens by addresses:', error);
      return new Map();
    }
  }
  
  /**
   * Get all tokens with dual addresses
   */
  async getTokensWithDualAddresses(limit: number = 100): Promise<TokenWithDualAddress[]> {
    try {
      const tokens = await this.db('tokens')
        .whereNotNull('pumpfun_address')
        .orderBy('market_cap', 'desc')
        .limit(limit);
      
      return tokens.map(row => ({
        address: row.address,
        splAddress: row.address,
        pumpfunAddress: row.pumpfun_address,
        symbol: row.symbol || 'LOADING...',
        name: row.name || 'Loading...',
        category: row.category || 'NEW',
        marketCap: parseFloat(row.market_cap || '0'),
        currentPriceUsd: parseFloat(row.current_price_usd || '0'),
        currentPriceSol: parseFloat(row.current_price_sol || '0'),
        bondingCurve: row.pumpfun_address,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Error getting tokens with dual addresses:', error);
      return [];
    }
  }
  
  /**
   * Update pump.fun address for existing token
   */
  async updatePumpfunAddress(splAddress: string, pumpfunAddress: string): Promise<void> {
    try {
      await this.db('tokens')
        .where('address', splAddress)
        .update({
          pumpfun_address: pumpfunAddress,
          bonding_curve: pumpfunAddress,
          updated_at: new Date()
        });
      
      logger.info(`✅ Updated pump.fun address for ${splAddress.substring(0, 8)}... → ${pumpfunAddress.substring(0, 8)}...`);
    } catch (error) {
      logger.error(`Error updating pump.fun address for ${splAddress}:`, error);
    }
  }
  
  private calculatePrice(virtualSolReserves: string, virtualTokenReserves: string): number {
    const solReserves = Number(virtualSolReserves) / 1e9;
    const tokenReserves = Number(virtualTokenReserves) / 1e6;
    
    if (tokenReserves === 0) return 0;
    
    return solReserves / tokenReserves;
  }
  
  private determineCategory(marketCap: number): string {
    if (marketCap < 8000) return 'NEW';
    if (marketCap < 15000) return 'LOW';
    if (marketCap < 25000) return 'MEDIUM';
    if (marketCap < 35000) return 'HIGH';
    if (marketCap < 105000) return 'AIM';
    return 'GRADUATED';
  }
}