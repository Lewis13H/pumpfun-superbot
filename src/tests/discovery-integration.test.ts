import { discoveryService } from '../discovery/discovery-service';

describe('Discovery Service Integration', () => {
  beforeAll(async () => {
    await discoveryService.initialize();
  });

  afterAll(async () => {
    await discoveryService.stop();
  });

  test('should initialize without errors', () => {
    const stats = discoveryService.getStats();
    expect(stats).toBeDefined();
    expect(stats.discovery.monitorsActive).toBe(2);
  });

  test('should start and stop cleanly', async () => {
    await discoveryService.start();
    let stats = discoveryService.getStats();
    expect(stats.isRunning).toBe(true);

    await discoveryService.stop();
    stats = discoveryService.getStats();
    expect(stats.isRunning).toBe(false);
  });
});
