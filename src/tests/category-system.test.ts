import { categoryManager } from '../../category/category-manager';
import { scanScheduler } from '../../category/scan-scheduler';
import { buySignalEvaluator } from '../../trading/buy-signal-evaluator';
import { db } from '../../database/postgres';

describe('Category System Integration', () => {
  beforeAll(async () => {
    // Setup test database
    await db.migrate.latest();
  });
  
  afterAll(async () => {
    await db.destroy();
  });
  
  describe('Full Token Lifecycle', () => {
    test('token progresses through categories correctly', async () => {
      // Create test token
      const tokenAddress = 'LIFECYCLE_TEST';
      await db('tokens').insert({
        address: tokenAddress,
        symbol: 'LIFE',
        category: 'NEW',
        market_cap: 1000,
        liquidity: 500,
        created_at: new Date(),
        discovered_at: new Date(),
      });
      
      // Create state machine
      await categoryManager.createOrRestoreStateMachine(tokenAddress, 'NEW');
      
      // Update to LOW
      await categoryManager.updateTokenMarketCap(tokenAddress, 5000);
      let state = categoryManager.getTokenState(tokenAddress);
      expect(state?.value).toBe('LOW');
      
      // Update to MEDIUM
      await categoryManager.updateTokenMarketCap(tokenAddress, 15000);
      state = categoryManager.getTokenState(tokenAddress);
      expect(state?.value).toBe('MEDIUM');
      
      // Update to HIGH
      await categoryManager.updateTokenMarketCap(tokenAddress, 25000);
      state = categoryManager.getTokenState(tokenAddress);
      expect(state?.value).toBe('HIGH');
      
      // Update to AIM
      await categoryManager.updateTokenMarketCap(tokenAddress, 40000);
      state = categoryManager.getTokenState(tokenAddress);
      expect(state?.value).toBe('AIM');
      
      // Verify transitions recorded
      const transitions = await db('category_transitions')
        .where('token_address', tokenAddress)
        .orderBy('created_at');
      
      expect(transitions).toHaveLength(4);
      expect(transitions[0].to_category).toBe('LOW');
      expect(transitions[3].to_category).toBe('AIM');
    });
    
    test('buy signal evaluation works for AIM tokens', async () => {
      // Create AIM token
      const tokenAddress = 'BUY_TEST';
      await db('tokens').insert({
        address: tokenAddress,
        symbol: 'BUY',
        category: 'AIM',
        market_cap: 45000,
        liquidity: 15000,
        holders: 200,
        top_10_percent: 20,
        solsniffer_score: 85,
        solsniffer_checked_at: new Date(),
        created_at: new Date(),
        discovered_at: new Date(),
      });
      
      // Evaluate
      const evaluation = await buySignalEvaluator.evaluateToken(tokenAddress);
      
      expect(evaluation.passed).toBe(true);
      expect(evaluation.criteria.marketCap).toBe(true);
      expect(evaluation.criteria.liquidity).toBe(true);
      expect(evaluation.criteria.holders).toBe(true);
      expect(evaluation.criteria.concentration).toBe(true);
      expect(evaluation.criteria.solsniffer).toBe(true);
    });
  });
  
  describe('Edge Cases', () => {
    test('handles rapid market cap changes', async () => {
      const tokenAddress = 'RAPID_TEST';
      await db('tokens').insert({
        address: tokenAddress,
        symbol: 'RAPID',
        category: 'LOW',
        market_cap: 5000,
        created_at: new Date(),
        discovered_at: new Date(),
      });
      
      await categoryManager.createOrRestoreStateMachine(tokenAddress, 'LOW');
      
      // Rapid jump to AIM
      await categoryManager.updateTokenMarketCap(tokenAddress, 50000);
      const state = categoryManager.getTokenState(tokenAddress);
      expect(state?.value).toBe('AIM');
    });
    
    test('handles tokens dropping categories', async () => {
      const tokenAddress = 'DROP_TEST';
      await db('tokens').insert({
        address: tokenAddress,
        symbol: 'DROP',
        category: 'HIGH',
        market_cap: 25000,
        created_at: new Date(),
        discovered_at: new Date(),
      });
      
      await categoryManager.createOrRestoreStateMachine(tokenAddress, 'HIGH');
      
      // Drop to LOW
      await categoryManager.updateTokenMarketCap(tokenAddress, 3000);
      const state = categoryManager.getTokenState(tokenAddress);
      expect(state?.value).toBe('LOW');
    });
  });
});

