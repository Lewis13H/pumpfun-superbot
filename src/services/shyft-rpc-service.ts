// src/services/shyft-rpc-service.ts
// Shyft RPC Service for token metadata and holder distribution

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger2';
import { EventEmitter } from 'events';

interface TokenInfo {
  name: string;
  symbol: string;
  description: string;
  decimals: number;
  supply: number;
  mint: string;
  image?: string;
}

interface ShyftApiResponse<T> {
  success: boolean;
  message?: string;
  result?: T;
}

interface ShyftTokenInfo {
  name: string;
  symbol: string;
  description: string;
  decimals: number;
  current_supply: number;
  image_uri?: string;
}

interface ShyftTokenHolder {
  owner: string;
  balance: string;
}

export class ShyftRPCService extends EventEmitter {
  private connection: Connection;
  private headers: Headers;
  private requestOptions: any;
  private apiKey: string;

  constructor() {
    super();
    
    // Get API key from environment
    this.apiKey = process.env.SHYFT_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('SHYFT_API_KEY not found - Shyft RPC will not work');
    }
    
    // Initialize Shyft RPC connection
    const rpcUrl = process.env.SHYFT_RPC_URL || `https://rpc.shyft.to?api_key=${this.apiKey}`;
    this.connection = new Connection(rpcUrl, 'confirmed');
    
    // Setup headers for REST API calls
    this.headers = new Headers();
    this.headers.append("x-api-key", this.apiKey);
    
    this.requestOptions = {
      method: 'GET',
      headers: this.headers,
      redirect: 'follow'
    };
    
    logger.info('✅ Shyft RPC Service initialized');
  }

  /**
   * Get token info using Shyft's REST API
   */
  async getTokenInfo(tokenMint: string): Promise<TokenInfo | null> {
    if (!this.apiKey) {
      return null;
    }
    
    try {
      const url = `https://api.shyft.to/sol/v1/token/get_info?network=mainnet-beta&token_address=${tokenMint}`;
      const response = await fetch(url, this.requestOptions);
      const data = await response.json() as ShyftApiResponse<ShyftTokenInfo>;
      
      if (!data.success || !data.result) {
        logger.warn(`Token info not found for: ${tokenMint}`);
        return null;
      }
      
      const tokenInfo: TokenInfo = {
        name: data.result.name || 'Unknown',
        symbol: data.result.symbol || 'Unknown',
        description: data.result.description || '',
        decimals: data.result.decimals || 6,
        supply: data.result.current_supply || 0,
        mint: tokenMint,
        image: data.result.image_uri
      };
      
      logger.info(`📝 Token info fetched: ${tokenInfo.symbol} (${tokenMint.substring(0, 8)}...)`);
      this.emit('tokenInfoFetched', tokenInfo);
      
      return tokenInfo;
    } catch (error) {
      logger.error(`Error fetching token info for ${tokenMint}:`, error);
      this.emit('error', { type: 'token_info', tokenMint, error });
      return null;
    }
  }

  /**
   * Get bonding curve balance using Shyft RPC
   */
  async getBondingCurveBalance(bondingCurveAddress: string): Promise<number> {
    try {
      const address = new PublicKey(bondingCurveAddress);
      const accountInfo = await this.connection.getAccountInfo(address);
      
      if (!accountInfo) {
        logger.warn(`Bonding curve not found: ${bondingCurveAddress}`);
        return 0;
      }
      
      const solBalance = accountInfo.lamports / 1e9; // Convert to SOL
      return Number(solBalance.toFixed(2));
    } catch (error) {
      logger.error(`Error fetching bonding curve balance:`, error);
      return 0;
    }
  }

  /**
   * Get token holders - useful for analyzing distribution
   */
  async getTokenHolders(tokenMint: string, limit: number = 10): Promise<any[]> {
    if (!this.apiKey) {
      return [];
    }
    
    try {
      const url = `https://api.shyft.to/sol/v1/token/get_holders?network=mainnet-beta&token_address=${tokenMint}&limit=${limit}`;
      const response = await fetch(url, this.requestOptions);
      const data = await response.json() as ShyftApiResponse<ShyftTokenHolder[]>;
      
      if (!data.success || !data.result) {
        return [];
      }
      
      // Calculate holder distribution
      const holders = data.result;
      const totalSupply = holders.reduce((sum: number, h: ShyftTokenHolder) => sum + parseFloat(h.balance || '0'), 0);
      
      const enrichedHolders = holders.map((holder: ShyftTokenHolder, index: number) => ({
        address: holder.owner,
        balance: parseFloat(holder.balance || '0'),
        percentage: (parseFloat(holder.balance || '0') / totalSupply) * 100,
        rank: index + 1
      }));
      
      return enrichedHolders;
    } catch (error) {
      logger.error(`Error fetching token holders:`, error);
      return [];
    }
  }

  /**
   * Test connection to Shyft API
   */
  async testConnection(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }
    
    try {
      // Test with USDC
      const testToken = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const info = await this.getTokenInfo(testToken);
      return info !== null && info.symbol === 'USDC';
    } catch (error) {
      logger.error('Shyft RPC test failed:', error);
      return false;
    }
  }
}