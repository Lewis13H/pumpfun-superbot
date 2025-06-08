import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { logger } from './logger2';
import { db } from '../database/postgres';

export interface CreatorWalletAnalysis {
  walletAddress: string;
  walletAgeDays: number;
  currentSolBalance: number;
  historicalMaxSol: number;
  totalTransactions: number;
  firstTransactionDate: Date | null;
  tokenCreationHistory: Array<{
    tokenAddress: string;
    createdAt: Date;
    graduated: boolean;
  }>;
  successRate: number;
}

export class CreatorWalletAnalyzer {
  constructor(private connection: Connection) {}
  
  async analyzeCreator(creatorAddress: string): Promise<CreatorWalletAnalysis> {
    try {
      const creatorPubkey = new PublicKey(creatorAddress);
      
      // Get current balance
      const balance = await this.connection.getBalance(creatorPubkey);
      const currentSolBalance = balance / 1e9;
      
      // Get transaction history summary
      const signatures = await this.connection.getSignaturesForAddress(
        creatorPubkey,
        { limit: 1000 }
      );
      
      let firstTransactionDate: Date | null = null;
      let walletAgeDays = 0;
      
      if (signatures.length > 0) {
        const oldestSig = signatures[signatures.length - 1];
        if (oldestSig.blockTime) {
          firstTransactionDate = new Date(oldestSig.blockTime * 1000);
          walletAgeDays = Math.floor(
            (Date.now() - firstTransactionDate.getTime()) / (1000 * 60 * 60 * 24)
          );
        }
      }
      
      // Get token creation history from database
      const createdTokens = await db('tokens')
        .where('creator', creatorAddress)
        .select('address', 'created_at', 'market_cap');
      
      const tokenCreationHistory = createdTokens.map(token => ({
        tokenAddress: token.address,
        createdAt: token.created_at,
        graduated: Number(token.market_cap) >= 69000
      }));
      
      const successRate = tokenCreationHistory.length > 0
        ? tokenCreationHistory.filter(t => t.graduated).length / tokenCreationHistory.length
        : 0;
      
      // Update creator profile
      await db('creator_profiles')
        .insert({
          creator_address: creatorAddress,
          wallet_age_days: walletAgeDays,
          current_sol_balance: currentSolBalance,
          total_transactions: signatures.length,
          first_transaction_date: firstTransactionDate,
          total_tokens_created: tokenCreationHistory.length,
          successful_tokens: tokenCreationHistory.filter(t => t.graduated).length,
          reputation_score: successRate,
          last_token_created: tokenCreationHistory[0]?.createdAt,
          created_at: new Date(),
          updated_at: new Date()
        })
        .onConflict('creator_address')
        .merge();
      
      return {
        walletAddress: creatorAddress,
        walletAgeDays,
        currentSolBalance,
        historicalMaxSol: currentSolBalance, // TODO: Calculate from history
        totalTransactions: signatures.length,
        firstTransactionDate,
        tokenCreationHistory,
        successRate
      };
    } catch (error) {
      logger.error('Error analyzing creator wallet:', error);
      throw error;
    }
  }
}
