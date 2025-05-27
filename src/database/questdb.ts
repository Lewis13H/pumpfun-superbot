import { config } from '../config';
import { logger } from '../utils/logger';

// Temporarily stub out QuestDB until we figure out the correct API
export async function getQuestDBSender(): Promise<any> {
  logger.warn('QuestDB temporarily disabled - using stub');
  return {
    table: () => ({
      symbol: () => ({ floatColumn: () => ({ intColumn: () => ({ at: () => ({ flush: async () => {} }) }) }) })
    })
  };
}

export async function closeQuestDB(): Promise<void> {
  logger.info('QuestDB stub closed');
}

export async function writeTokenMetrics(data: any): Promise<void> {
  logger.debug('Would write token metrics to QuestDB:', data);
}

export async function writeDiscoveryEvent(data: any): Promise<void> {
  logger.debug('Would write discovery event to QuestDB:', data);
}