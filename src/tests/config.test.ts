import { config } from '../config';

describe('Configuration', () => {
  test('should load all required environment variables', () => {
    expect(config.postgres.host).toBeDefined();
    expect(config.postgres.database).toBeDefined();
    expect(config.apis.heliusRpcUrl).toBeDefined();
  });
  
  test('should have valid port numbers', () => {
    expect(config.port).toBeGreaterThan(0);
    expect(config.port).toBeLessThan(65536);
  });
});
