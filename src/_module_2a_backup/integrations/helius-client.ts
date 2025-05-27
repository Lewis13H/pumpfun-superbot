// src/integrations/helius-client.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { BaseAPIClient } from './base-api-client';
import { HeliusTokenMetadata, HeliusTokenHolder, HeliusEnhancedTransaction, TokenMetadata } from './types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class HeliusClient extends BaseAPIClient {
  private connection: Connection;

  constructor() {
    // Extract API key from RPC URL if present
    const urlParts = config.apis.heliusRpcUrl.split('?api-key=');
    const apiKey = urlParts[1] || '';
    
    super(
      'Helius',
      'https://api.helius.xyz/v0',
      {
        maxRequests: 50,
        windowMs: 60000,
        retryAfter: 60000,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    this.connection = new Connection(config.apis.heliusRpcUrl);
  }

  async getTokenMetadata(mintAddress: string): Promise<HeliusTokenMetadata | null> {
    try {
      logger.debug(`Fetching Helius metadata for ${mintAddress}`);
      
      // Try multiple methods to get token metadata
      
      // Method 1: Use Helius DAS API
      const dasMetadata = await this.getAssetMetadata(mintAddress);
      if (dasMetadata) return dasMetadata;

      // Method 2: Fetch from token's metadata account
      const metadataFromChain = await this.getMetadataFromChain(mintAddress);
      if (metadataFromChain) return metadataFromChain;

      // Method 3: Basic on-chain data
      return await this.getBasicTokenInfo(mintAddress);
    } catch (error: any) {
      logger.error(`Helius metadata error for ${mintAddress}:`, {
        message: error.message,
      });
      return null;
    }
  }

  private async getAssetMetadata(mintAddress: string): Promise<HeliusTokenMetadata | null> {
    try {
      const urlParts = config.apis.heliusRpcUrl.split('?api-key=');
      const apiKey = urlParts[1] || '';
      
      const response = await this.makeRequest<any>({
        method: 'POST',
        url: `/assets?api-key=${apiKey}`,
        data: {
          ids: [mintAddress],
          displayOptions: {
            showFungible: true,
          },
        },
      });

      if (!response || response.length === 0) return null;

      const asset = response[0];
      return {
        mint: mintAddress,
        symbol: asset.content?.metadata?.symbol || 'UNKNOWN',
        name: asset.content?.metadata?.name || 'Unknown Token',
        uri: asset.content?.json_uri,
        decimals: asset.token_info?.decimals || 9,
        description: asset.content?.metadata?.description,
        image: asset.content?.links?.image || asset.content?.files?.[0]?.uri,
        externalUrl: asset.content?.links?.external_url,
      };
    } catch (error) {
      logger.debug(`Helius DAS API not available for ${mintAddress}`);
      return null;
    }
  }

  private async getMetadataFromChain(mintAddress: string): Promise<HeliusTokenMetadata | null> {
    try {
      const mint = new PublicKey(mintAddress);
      
      // Get token metadata PDA
      const [metadataPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
      );

      const accountInfo = await this.connection.getAccountInfo(metadataPDA);
      if (!accountInfo) return null;

      // Parse metadata (simplified - real implementation would need proper deserialization)
      const data = accountInfo.data;
      
      // This is a simplified extraction - real implementation would use Metaplex SDK
      return null;
    } catch (error) {
      logger.debug(`Could not fetch on-chain metadata for ${mintAddress}`);
      return null;
    }
  }

  private async getBasicTokenInfo(mintAddress: string): Promise<HeliusTokenMetadata | null> {
    try {
      const mint = new PublicKey(mintAddress);
      const mintInfo = await this.connection.getParsedAccountInfo(mint);
      
      if (!mintInfo.value || !('parsed' in mintInfo.value.data)) {
        return null;
      }

      const parsed = mintInfo.value.data.parsed;
      return {
        mint: mintAddress,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: parsed.info.decimals,
      };
    } catch (error) {
      logger.error(`Failed to get basic token info for ${mintAddress}`);
      return null;
    }
  }

  async getTokenHolders(mintAddress: string, limit: number = 100): Promise<HeliusTokenHolder[]> {
    try {
      logger.debug(`Fetching token holders for ${mintAddress}`);
      
      const mint = new PublicKey(mintAddress);
      
      // Get largest token accounts
      const tokenAccounts = await this.connection.getTokenLargestAccounts(mint);
      
      if (!tokenAccounts.value || tokenAccounts.value.length === 0) {
        logger.warn(`No token accounts found for ${mintAddress}`);
        return [];
      }

      // Get the owner of each token account
      const holders: HeliusTokenHolder[] = [];
      const totalSupply = tokenAccounts.value.reduce(
        (sum, account) => sum + Number(account.amount),
        0
      );

      for (const account of tokenAccounts.value.slice(0, limit)) {
        try {
          const accountInfo = await this.connection.getParsedAccountInfo(account.address);
          
          if (accountInfo.value && 'parsed' in accountInfo.value.data) {
            const owner = accountInfo.value.data.parsed.info.owner;
            const balance = account.amount;
            const percentage = (Number(balance) / totalSupply) * 100;
            
            holders.push({
              owner,
              balance,
              percentage,
            });
          }
        } catch (error) {
          logger.debug(`Failed to get account info for ${account.address}`);
        }
      }

      logger.info(`Retrieved ${holders.length} holders for ${mintAddress}`);
      return holders;
    } catch (error: any) {
      logger.error(`Failed to get token holders for ${mintAddress}:`, {
        message: error.message,
      });
      return [];
    }
  }

  async getEnhancedTransactions(
    address: string,
    limit: number = 100
  ): Promise<HeliusEnhancedTransaction[]> {
    try {
      const urlParts = config.apis.heliusRpcUrl.split('?api-key=');
      const apiKey = urlParts[1] || '';
      
      const response = await this.makeRequest<HeliusEnhancedTransaction[]>({
        method: 'GET',
        url: `/addresses/${address}/transactions`,
        params: {
          'api-key': apiKey,
          limit,
        },
      });

      return response || [];
    } catch (error: any) {
      logger.error(`Failed to get enhanced transactions for ${address}:`, {
        message: error.message,
      });
      return [];
    }
  }

  async getTokenCreationInfo(mintAddress: string): Promise<{
    creator: string | null;
    creationTime: Date | null;
    initialSupply: string | null;
  }> {
    try {
      const transactions = await this.getEnhancedTransactions(mintAddress, 1000);
      
      // Find the token creation transaction
      const creationTx = transactions.find(tx => 
        tx.type === 'TOKEN_MINT' || 
        tx.instructions?.some(ix => ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      );

      if (!creationTx) {
        return {
          creator: null,
          creationTime: null,
          initialSupply: null,
        };
      }

      return {
        creator: creationTx.feePayer,
        creationTime: new Date(creationTx.timestamp * 1000),
        initialSupply: null, // Would need to parse instruction data
      };
    } catch (error) {
      logger.error(`Failed to get token creation info for ${mintAddress}`);
      return {
        creator: null,
        creationTime: null,
        initialSupply: null,
      };
    }
  }

  // Helper to convert Helius metadata to our standard format
  convertToTokenMetadata(heliusData: HeliusTokenMetadata): TokenMetadata {
    return {
      address: heliusData.mint,
      symbol: heliusData.symbol,
      name: heliusData.name,
      decimals: heliusData.decimals,
      description: heliusData.description,
      image: heliusData.image,
      website: heliusData.externalUrl,
    };
  }

  // Check if a holder is likely a developer wallet
  async isDeveloperWallet(wallet: string, mintAddress: string): Promise<boolean> {
    try {
      const transactions = await this.getEnhancedTransactions(wallet, 50);
      
      // Check if this wallet created the token
      const createdToken = transactions.some(tx => 
        tx.type === 'TOKEN_MINT' && 
        tx.tokenTransfers?.some(transfer => transfer.mint === mintAddress)
      );

      if (createdToken) return true;

      // Check if wallet received tokens very early (within first 10 transactions)
      const earlyTransactions = await this.getEnhancedTransactions(mintAddress, 10);
      const receivedEarly = earlyTransactions.some(tx =>
        tx.tokenTransfers?.some(transfer => 
          transfer.toUserAccount === wallet && 
          transfer.mint === mintAddress
        )
      );

      return receivedEarly;
    } catch (error) {
      logger.debug(`Failed to check if ${wallet} is developer wallet`);
      return false;
    }
  }
}