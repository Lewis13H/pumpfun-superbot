// scripts/update-unknown-tokens.js

const { Connection, PublicKey } = require('@solana/web3.js');
const { Metadata } = require('@metaplex-foundation/mpl-token-metadata');
const { db } = require('../src/database/postgres');

class TokenMetadataUpdater {
  constructor() {
    // Use your Helius RPC endpoint
    this.connection = new Connection(
      process.env.RPC_ENDPOINT || 'https://mainnet.helius-rpc.com/?api-key=d2fa57b6-40cc-45e4-80f8-285377ec5dea'
    );
  }
  
  async findMetadataPDA(mint) {
    const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    
    const [metadataPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from('metadata'),
        METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );
    
    return metadataPDA;
  }
  
  async fetchTokenMetadata(tokenAddress) {
    try {
      console.log(`Fetching metadata for ${tokenAddress}...`);
      
      const mintPubkey = new PublicKey(tokenAddress);
      
      // Get mint info
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);
      let totalSupply = 0;
      let decimals = 6;
      
      if (mintInfo.value && 'parsed' in mintInfo.value.data) {
        const parsed = mintInfo.value.data.parsed;
        if (parsed.type === 'mint' && parsed.info) {
          totalSupply = parsed.info.supply ? parseInt(parsed.info.supply) : 0;
          decimals = parsed.info.decimals || 6;
        }
      }
      
      // Get metadata
      const metadataPDA = await this.findMetadataPDA(mintPubkey);
      const metadataAccount = await this.connection.getAccountInfo(metadataPDA);
      
      if (!metadataAccount) {
        console.log(`No metadata found for ${tokenAddress}`);
        return null;
      }
      
      const metadata = Metadata.deserialize(metadataAccount.data)[0];
      
      return {
        symbol: metadata.data.symbol.replace(/\0/g, '').trim(),
        name: metadata.data.name.replace(/\0/g, '').trim(),
        uri: metadata.data.uri.replace(/\0/g, '').trim(),
        totalSupply: totalSupply / Math.pow(10, decimals),
        decimals
      };
      
    } catch (error) {
      console.error(`Error fetching metadata for ${tokenAddress}:`, error.message);
      return null;
    }
  }
  
  async updateAllUnknownTokens() {
    try {
      // Get all unknown tokens
      const unknownTokens = await db('tokens')
        .where('symbol', 'UNKNOWN')
        .orWhere('name', 'Unknown Token')
        .select('address');
      
      console.log(`Found ${unknownTokens.length} tokens to update`);
      
      let updated = 0;
      let failed = 0;
      
      // Process in batches
      const batchSize = 5;
      for (let i = 0; i < unknownTokens.length; i += batchSize) {
        const batch = unknownTokens.slice(i, i + batchSize);
        
        const promises = batch.map(async (token) => {
          const metadata = await this.fetchTokenMetadata(token.address);
          
          if (metadata) {
            await db('tokens')
              .where('address', token.address)
              .update({
                symbol: metadata.symbol,
                name: metadata.name,
                total_supply: metadata.totalSupply,
                updated_at: new Date()
              });
            
            console.log(`✅ Updated ${token.address}: ${metadata.symbol} - ${metadata.name}`);
            updated++;
          } else {
            console.log(`❌ Failed to update ${token.address}`);
            failed++;
          }
        });
        
        await Promise.all(promises);
        
        // Progress update
        console.log(`Progress: ${i + batch.length}/${unknownTokens.length}`);
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`\n✅ Update complete!`);
      console.log(`Updated: ${updated}`);
      console.log(`Failed: ${failed}`);
      
    } catch (error) {
      console.error('Error updating tokens:', error);
    } finally {
      await db.destroy();
    }
  }
}

// Run the updater
async function main() {
  const updater = new TokenMetadataUpdater();
  await updater.updateAllUnknownTokens();
}

main().catch(console.error);