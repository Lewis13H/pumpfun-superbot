import { AnalysisOrchestrator } from './analysis-orchestrator';
import { logger } from '../utils/logger';

export class AnalysisService {
  private orchestrator: AnalysisOrchestrator;
  private isInitialized: boolean = false;

  constructor() {
    this.orchestrator = new AnalysisOrchestrator();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Analysis Service already initialized');
      return;
    }

    logger.info('Initializing Analysis Service');
    
    await this.orchestrator.initialize();
    
    // Set up event handlers
    this.setupEventHandlers();
    
    this.isInitialized = true;
    logger.info('Analysis Service initialized');
  }

  private setupEventHandlers(): void {
    this.orchestrator.on('analysisComplete', (analysis) => {
      logger.info(`Analysis complete: ${analysis.symbol} - Score: ${analysis.scores.overallScore}`);
    });

    this.orchestrator.on('analysisError', ({ token, error }) => {
      logger.error(`Analysis error for ${token.symbol}:`, error);
    });

    this.orchestrator.on('queueIdle', () => {
      logger.debug('Analysis queue is idle');
    });
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    await this.orchestrator.start();
    logger.info('Analysis Service started');
  }

  async stop(): Promise<void> {
    await this.orchestrator.stop();
    logger.info('Analysis Service stopped');
  }

  getStats() {
    return this.orchestrator.getStats();
  }
}

// Export singleton instance
export const analysisService = new AnalysisService();