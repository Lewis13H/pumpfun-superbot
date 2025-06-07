import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger';

export interface ComprehensiveTokenMetadata {
  // Core identifiers
  address: string;
  symbol: string;
  name: string;
  description?: string;
  decimals: number;
  totalSupply: string;
  
  // Creation details
  creationBlock?: number;
  creationTxHash?: string;
  creationSlot?: number;
  
  // Visual assets
  imageUrl?: string;
  imageHash?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
  additionalMedia?: any;
  
  // Contract configuration
  mintAuthority?: string | null;
  updateAuthority?: string;
  freezeAuthority?: string | null;
  isMutable: boolean;
  isMintable: boolean;
  isFreezable: boolean;
  transferFeeConfig?: any;
}

export class TokenMetadataFetcher {
  constructor(private connection: Connection) {}
  
  async fetchComprehensiveMetadata(
    tokenAddress: string,
    creationSignature?: string
  ): Promise<ComprehensiveTokenMetadata> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      
      // Fetch mint info
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);
      if (!mintInfo.value || !('parsed' in mintInfo.value.data)) {
        throw new Error('Invalid mint account');
      }
      
      const mintData = mintInfo.value.data.parsed.info;
      
      // Get creation details if signature provided
      let creationDetails = {};
      if (creationSignature) {
        try {
          const tx = await this.connection.getParsedTransaction(creationSignature, {
            maxSupportedTransactionVersion: 0
          });
          if (tx) {
            creationDetails = {
              creationBlock: tx.slot,
              creationTxHash: creationSignature,
              creationSlot: tx.slot,
            };
          }
        } catch (error) {
          logger.error('Error fetching creation transaction:', error);
        }
      }
      
      // For now, we'll skip the Metaplex metadata fetching and just return basic data
      // This can be enhanced later when we figure out the correct Metaplex imports
      
      return {
        address: tokenAddress,
        symbol: mintData.symbol || 'UNKNOWN',
        name: mintData.name || 'Unknown Token',
        description: undefined,
        decimals: mintData.decimals || 6,
        totalSupply: mintData.supply || '0',
        
        ...creationDetails,
        
        // These fields will be empty for now
        imageUrl: undefined,
        imageHash: undefined,
        websiteUrl: undefined,
        twitterUrl: undefined,
        telegramUrl: undefined,
        discordUrl: undefined,
        additionalMedia: undefined,
        
        // Contract configuration from mint data
        mintAuthority: mintData.mintAuthority,
        updateAuthority: undefined, // Would come from metadata account
        freezeAuthority: mintData.freezeAuthority,
        isMutable: true, // Default, would come from metadata
        isMintable: mintData.mintAuthority !== null,
        isFreezable: mintData.freezeAuthority !== null,
        transferFeeConfig: mintData.transferFeeConfig,
      };
    } catch (error) {
      logger.error('Error fetching comprehensive metadata:', error);
      // Return minimal metadata on error
      return {
        address: tokenAddress,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 6,
        totalSupply: '0',
        isMutable: true,
        isMintable: false,
        isFreezable: false,
      };
    }
  }
  
  private async fetchOffChainMetadata(uri: string): Promise<any> {
    try {
      const response = await axios.get(uri, { timeout: 5000 });
      const data = response.data;
      
      const result: any = {
        description: data.description,
        imageUrl: data.image,
        additionalMedia: data.properties?.files,
      };
      
      // Calculate image hash if present
      if (data.image) {
        try {
          const imageResponse = await axios.get(data.image, {
            responseType: 'arraybuffer',
            timeout: 10000
          });
          result.imageHash = crypto
            .createHash('sha256')
            .update(Buffer.from(imageResponse.data))
            .digest('hex');
        } catch (error) {
          logger.debug('Could not fetch image for hashing');
        }
      }
      
      // Extract social links
      if (data.external_url) result.websiteUrl = data.external_url;
      
      if (data.properties?.socials) {
        const socials = data.properties.socials;
        if (socials.twitter) result.twitterUrl = socials.twitter;
        if (socials.telegram) result.telegramUrl = socials.telegram;
        if (socials.discord) result.discordUrl = socials.discord;
      }
      
      // Alternative social link locations
      if (data.extensions?.socials) {
        const socials = data.extensions.socials;
        result.twitterUrl = result.twitterUrl || socials.twitter;
        result.telegramUrl = result.telegramUrl || socials.telegram;
        result.discordUrl = result.discordUrl || socials.discord;
      }
      
      return result;
    } catch (error) {
      logger.error('Error fetching off-chain metadata:', error);
      return {};
    }
  }
}
