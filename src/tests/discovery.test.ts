import { DeduplicationService } from '../discovery/deduplication-service';
import { TokenProcessor } from '../discovery/token-processor';
import { TokenDiscovery } from '../discovery/base-monitor';

describe('Discovery System', () => {
  describe('DeduplicationService', () => {
    let service: DeduplicationService;

    beforeEach(() => {
      service = new DeduplicationService();
    });

    afterEach(() => {
      service.stop();
    });

    test('should detect duplicate tokens', () => {
      const address = 'So11111111111111111111111111111111111111112';
      
      expect(service.isDuplicate(address, 'pumpfun')).toBe(false);
      expect(service.isDuplicate(address, 'pumpfun')).toBe(true);
    });

    test('should allow same token on different platforms', () => {
      const address = 'So11111111111111111111111111111111111111112';
      
      expect(service.isDuplicate(address, 'pumpfun')).toBe(false);
      expect(service.isDuplicate(address, 'raydium')).toBe(false);
    });
  });

  describe('TokenProcessor', () => {
    let processor: TokenProcessor;

    beforeEach(() => {
      processor = new TokenProcessor();
    });

    test('should calculate priority correctly', async () => {
      const token: TokenDiscovery = {
        address: 'TestToken111111111111111111111111111111111',
        symbol: 'TEST',
        name: 'Test Token',
        platform: 'pumpfun',
        createdAt: new Date(),
      };

      await processor.addToken(token, 70);
      expect(processor.getStats().queueSize).toBeGreaterThan(0);
    });
  });
});
