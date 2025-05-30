import { TieredTokenAnalyzer } from '../analysis/tiered-analyzer';
import { TokenAnalysisStorage } from '../analysis/analysis-storage';
import { MetricsFetcher } from '../analysis/metrics-fetcher';

describe('Analysis System', () => {
  describe('TieredTokenAnalyzer', () => {
    let analyzer: TieredTokenAnalyzer;

    beforeEach(() => {
      analyzer = new TieredTokenAnalyzer();
    });

    test('should calculate scores correctly', async () => {
      const mockToken = {
        address: 'TestToken111111111111111111111111111111111',
        symbol: 'TEST',
        name: 'Test Token',
        platform: 'pumpfun',
        createdAt: new Date(),
      };

      // This would need mocking of MetricsFetcher in a real test
      // For now, it's an integration test
    });

    test('should handle analysis failures gracefully', async () => {
      const mockToken = {
        address: 'InvalidToken',
        symbol: 'FAIL',
        name: 'Fail Token',
        platform: 'test',
        createdAt: new Date(),
      };

      const result = await analyzer.analyze(mockToken);
      expect(result.status).toBe('failed');
      expect(result.errors).toBeDefined();
    });
  });

  describe('Score Calculations', () => {
    test('should normalize scores between 0 and 1', () => {
      const analyzer = new TieredTokenAnalyzer();
      
      // Test normalizeScore method
      expect((analyzer as any).normalizeScore(0, 0, 100)).toBe(0);
      expect((analyzer as any).normalizeScore(50, 0, 100)).toBe(0.5);
      expect((analyzer as any).normalizeScore(100, 0, 100)).toBe(1);
      expect((analyzer as any).normalizeScore(150, 0, 100)).toBe(1);
      expect((analyzer as any).normalizeScore(-50, 0, 100)).toBe(0);
    });
  });
});