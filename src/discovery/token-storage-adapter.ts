// src/discovery/token-storage-adapter.ts
import { db } from '../database/postgres';
import { logger } from '../utils/logger';
import { TokenDiscovery } from './base-monitor';
import { EnhancedTokenDiscovery } from './enhanced-pumpfun-monitor';

/**
 * Adapter to store discovered tokens in the existing schema
 */
export class TokenStorageAdapter {
  /**
   * Store a discovered token with pump.fun enhancements
   */
  async storeDiscoveredToken(token: TokenDiscovery | EnhancedTokenDiscovery): Promise<void> {
    try {
      // Check if this is an enhanced pump.fun token
      const isPumpFun = token.platform === 'pumpfun';
      const enhancedToken = token as EnhancedTokenDiscovery;

      // Prepare base token data
      const tokenData: any = {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        created_at: token.createdAt,
        discovered_at: new Date(),
        status: 'active',
        metadata: token.metadata || {},
      };

      // Add pump.fun specific fields if available
      if (isPumpFun && enhancedToken.bondingCurve) {
        tokenData.is_pump_fun = true;
        tokenData.bonding_curve = enhancedToken.bondingCurve;
        tokenData.associated_bonding_curve = enhancedToken.associatedBondingCurve;
        tokenData.creator = enhancedToken.creator;
        tokenData.creator_vault = enhancedToken.creatorVault;
        tokenData.initial_price_sol = enhancedToken.initialPrice;
        tokenData.initial_liquidity_sol = enhancedToken.initialLiquidity;
        tokenData.curve_progress = enhancedToken.curveProgress;
        tokenData.virtual_sol_reserves = enhancedToken.virtualSolReserves;
        tokenData.virtual_token_reserves = enhancedToken.virtualTokenReserves;
        tokenData.discovery_method = token.metadata?.method || 'unknown';
        
        // Calculate initial market cap if we have price and supply
        if (enhancedToken.initialPrice && token.metadata?.totalSupply) {
          tokenData.initial_market_cap_sol = enhancedToken.initialPrice * (token.metadata.totalSupply / 1e6);
        }
      }

      // Insert or update token
      await db('tokens')
        .insert(tokenData)
        .onConflict('address')
        .merge({
          // Update these fields if token already exists
          symbol: tokenData.symbol,
          name: tokenData.name,
          updated_at: new Date(),
          metadata: db.raw('tokens.metadata || ?::jsonb', [JSON.stringify(token.metadata || {})]),
        });

      logger.info(`Stored token ${token.symbol} (${token.address}) in database`);

      // Update creator profile if this is a pump.fun token
      if (isPumpFun && enhancedToken.creator) {
        await this.updateCreatorProfile(enhancedToken.creator);
      }

      // Store pump.fun event if this is a creation
      if (isPumpFun && token.metadata?.signature) {
        await this.storePumpFunEvent({
          event_type: 'create',
          token_address: token.address,
          transaction_signature: token.metadata.signature,
          event_data: {
            name: token.name,
            symbol: token.symbol,
            creator: enhancedToken.creator,
            initialPrice: enhancedToken.initialPrice,
            initialLiquidity: enhancedToken.initialLiquidity,
          },
          block_time: token.createdAt,
        });
      }

    } catch (error) {
      logger.error(`Failed to store token ${token.address}:`, error);
      throw error;
    }
  }

  /**
   * Update creator profile statistics
   */
  private async updateCreatorProfile(creatorAddress: string): Promise<void> {
    try {
      // Check if profile exists
      const profile = await db('creator_profiles')
        .where('address', creatorAddress)
        .first();

      if (!profile) {
        // Create new profile
        await db('creator_profiles').insert({
          address: creatorAddress,
          total_tokens_created: 1,
          active_tokens: 1,
          first_token_at: new Date(),
          last_token_at: new Date(),
          reputation_score: 0.5, // Start with neutral reputation
        });
      } else {
        // Update existing profile
        await db('creator_profiles')
          .where('address', creatorAddress)
          .update({
            total_tokens_created: db.raw('total_tokens_created + 1'),
            active_tokens: db.raw('active_tokens + 1'),
            last_token_at: new Date(),
            updated_at: new Date(),
          });
      }
    } catch (error) {
      logger.error(`Failed to update creator profile ${creatorAddress}:`, error);
    }
  }

  /**
   * Store pump.fun event
   */
  private async storePumpFunEvent(event: {
    event_type: string;
    token_address: string;
    transaction_signature: string;
    event_data: any;
    block_time: Date;
  }): Promise<void> {
    try {
      await db('pump_fun_events')
        .insert(event)
        .onConflict('transaction_signature')
        .ignore(); // Ignore if event already exists
    } catch (error) {
      logger.error('Failed to store pump.fun event:', error);
    }
  }

  /**
   * Get recent pump.fun tokens
   */
  async getRecentPumpFunTokens(limit: number = 50): Promise<any[]> {
    return db('tokens')
      .where('is_pump_fun', true)
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get tokens by creator
   */
  async getTokensByCreator(creatorAddress: string): Promise<any[]> {
    return db('tokens')
      .where('creator', creatorAddress)
      .orderBy('created_at', 'desc');
  }

  /**
   * Update bonding curve snapshot
   */
  async updateBondingCurveSnapshot(tokenAddress: string, curveData: any): Promise<void> {
    try {
      await db('pump_fun_curve_snapshots').insert({
        token_address: tokenAddress,
        virtual_sol_reserves: curveData.virtualSolReserves,
        virtual_token_reserves: curveData.virtualTokenReserves,
        real_sol_reserves: curveData.realSolReserves,
        real_token_reserves: curveData.realTokenReserves,
        price_sol: curveData.price,
        curve_progress: curveData.progress,
        complete: curveData.complete,
      });

      // Update token with latest curve progress
      if (curveData.complete) {
        await db('tokens')
          .where('address', tokenAddress)
          .update({
            bonding_complete_at: new Date(),
            curve_progress: 100,
          });
      } else {
        await db('tokens')
          .where('address', tokenAddress)
          .update({
            curve_progress: curveData.progress,
          });
      }
    } catch (error) {
      logger.error(`Failed to update bonding curve snapshot for ${tokenAddress}:`, error);
    }
  }
}