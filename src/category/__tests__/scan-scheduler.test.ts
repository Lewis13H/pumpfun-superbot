import { scanScheduler } from '../scan-scheduler';
import { TokenCategory } from '../../config/category-config';

describe('ScanScheduler', () => {
  beforeEach(() => {
    // Reset scheduler
  });
  
  test('schedules token correctly', async () => {
    const tokenAddress = 'TEST123';
    const category: TokenCategory = 'HIGH';
    
    await scanScheduler.scheduleToken(tokenAddress, category);
    
    const stats = scanScheduler.getStats();
    expect(stats[category].totalTasks).toBe(1);
  });
  
  test('removes token from all schedules', async () => {
    const tokenAddress = 'TEST123';
    
    // Schedule in multiple categories (shouldn't happen but test it)
    await scanScheduler.scheduleToken(tokenAddress, 'LOW');
    await scanScheduler.scheduleToken(tokenAddress, 'HIGH');
    
    const stats = scanScheduler.getStats();
    expect(stats.LOW.totalTasks).toBe(0);
    expect(stats.HIGH.totalTasks).toBe(1);
  });
  
  test('handles category change', async () => {
    const tokenAddress = 'TEST123';
    
    await scanScheduler.scheduleToken(tokenAddress, 'LOW');
    await scanScheduler.handleCategoryChange(tokenAddress, 'LOW', 'HIGH');
    
    const stats = scanScheduler.getStats();
    expect(stats.LOW.totalTasks).toBe(0);
    expect(stats.HIGH.totalTasks).toBe(1);
  });
});

