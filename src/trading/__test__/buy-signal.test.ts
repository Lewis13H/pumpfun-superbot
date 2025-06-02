import { buySignalEvaluator } from '../buy-signal-evaluator';
import { positionSizer } from '../position-sizer';
import { db } from '../../database/postgres';

describe('Buy Signal System', () => {
  describe('BuySignalEvaluator', () => {
    test('evaluates passing token correctly', async () => {
      // Create test token
      await db('tokens').insert({
        address: 'PASS123',
        symbol: 'PASS',
        category: 'AIM',
        market_cap: 45000,
        liquidity: 15000,
        holders: 200,
        top_10_percent: 20,
        solsniffer_score: 85,
        solsniffer_checked_at: new Date(),
      });
      
      const evaluation = await buySignalEvaluator.evaluateToken('PASS123');
      
      expect(evaluation.passed).toBe(true);
      expect(evaluation.failureReasons).toHaveLength(0);
      expect(evaluation.confidence).toBeGreaterThan(0.5);
    });
    
    test('evaluates failing token correctly', async () => {
      // Create test token with low liquidity
      await db('tokens').insert({
        address: 'FAIL123',
        symbol: 'FAIL',
        category: 'AIM',
        market_cap: 45000,
        liquidity: 5000, // Below minimum
        holders: 200,
        top_10_percent: 20,
        solsniffer_score: 85,
        solsniffer_checked_at: new Date(),
      });
      
      const evaluation = await buySignalEvaluator.evaluateToken('FAIL123');
      
      expect(evaluation.passed).toBe(false);
      expect(evaluation.failureReasons).toContain(
        'Liquidity $5000 below minimum $7500'
      );
    });
    
    test('rejects blacklisted SolSniffer score', async () => {
      await db('tokens').insert({
        address: 'BLACK123',
        symbol: 'BLACK',
        category: 'AIM',
        market_cap: 45000,
        liquidity: 15000,
        holders: 200,
        top_10_percent: 20,
        solsniffer_score: 90, // Blacklisted
        solsniffer_checked_at: new Date(),
      });
      
      const evaluation = await buySignalEvaluator.evaluateToken('BLACK123');
      
      expect(evaluation.passed).toBe(false);
      expect(evaluation.criteria.solsniffer).toBe(false);
    });
  });
  
  describe('PositionSizer', () => {
    test('calculates position with no limits', () => {
      const evaluation = {
        passed: true,
        solsnifferScore: 95,
        holders: 1000,
        top10Percent: 15,
      } as any;
      
      const position = positionSizer.calculatePosition(evaluation);
      
      expect(position.finalPosition).toBe(1.0); // Full position
      expect(position.reasoning).toContain('No limiting factors - full position allowed');
    });
    
    test('applies SolSniffer limit', () => {
      const evaluation = {
        passed: true,
        solsnifferScore: 65, // Tier 1 limit
        holders: 1000,
        top10Percent: 15,
      } as any;
      
      const position = positionSizer.calculatePosition(evaluation);
      
      expect(position.finalPosition).toBe(0.1);
      expect(position.limitFactors.solsniffer).toBe(0.1);
    });
    
    test('applies holder limit', () => {
      const evaluation = {
        passed: true,
        solsnifferScore: 95,
        holders: 100, // Tier 1 limit
        top10Percent: 15,
      } as any;
      
      const position = positionSizer.calculatePosition(evaluation);
      
      expect(position.finalPosition).toBe(0.1);
      expect(position.limitFactors.holders).toBe(0.1);
    });
    
    test('applies concentration limit', () => {
      const evaluation = {
        passed: true,
        solsnifferScore: 95,
        holders: 1000,
        top10Percent: 30, // Above threshold
      } as any;
      
      const position = positionSizer.calculatePosition(evaluation);
      
      expect(position.finalPosition).toBe(0.1);
      expect(position.limitFactors.concentration).toBe(0.1);
    });
    
    test('takes minimum of all limits', () => {
      const evaluation = {
        passed: true,
        solsnifferScore: 75, // 0.25 limit
        holders: 100, // 0.1 limit
        top10Percent: 30, // 0.1 limit
      } as any;
      
      const position = positionSizer.calculatePosition(evaluation);
      
      expect(position.finalPosition).toBe(0.1); // Minimum
    });
  });
});
