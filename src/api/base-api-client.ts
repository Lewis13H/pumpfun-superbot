import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { logger } from '../utils/logger';

export interface APICallRecord {
  service: string;
  endpoint: string;
  cost: number;
  timestamp: Date;
  success: boolean;
  responseTime: number;
}

export abstract class BaseAPIClient {
  protected client: AxiosInstance;
  protected serviceName: string;
  protected baseURL: string;
  protected apiKey?: string;
  protected rateLimiter: RateLimiter;
  protected costTracker: CostTracker;

  constructor(serviceName: string, baseURL: string, apiKey?: string) {
    this.serviceName = serviceName;
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    
    this.client = axios.create({
      baseURL,
      timeout: 30000, // Increased to 30 seconds
      headers: {
        'User-Agent': 'Solana-Token-Discovery/1.0',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
      }
    });

    this.rateLimiter = new RateLimiter(serviceName);
    this.costTracker = new CostTracker(serviceName);
    
    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for rate limiting
    this.client.interceptors.request.use(async (config) => {
      await this.rateLimiter.waitForSlot();
      // Add custom property safely
      (config as any).requestStartTime = Date.now();
      return config;
    });

    // Response interceptor for logging and cost tracking
    this.client.interceptors.response.use(
      (response) => {
        const responseTime = Date.now() - ((response.config as any).requestStartTime || Date.now());
        this.recordAPICall(response.config.url || '', 0, true, responseTime);
        return response;
      },
      (error) => {
        const responseTime = Date.now() - ((error.config as any)?.requestStartTime || Date.now());
        this.recordAPICall(error.config?.url || '', 0, false, responseTime);
        
        if (error.response?.status === 429) {
          logger.warn(`Rate limit hit for ${this.serviceName}`);
          this.rateLimiter.handleRateLimit();
        }
        
        throw error;
      }
    );
  }

  protected async makeRequest<T>(
    endpoint: string, 
    options: AxiosRequestConfig = {}, 
    estimatedCost: number = 0
  ): Promise<T> {
    try {
      // Check if we're within budget
      if (!this.costTracker.canMakeCall(estimatedCost)) {
        throw new Error(`Budget limit reached for ${this.serviceName}`);
      }

      // DEBUG: Log request details for solsniffer
      if (this.serviceName === 'solsniffer') {
        console.log('[DEBUG] Solsniffer request:', {
          url: endpoint,
          baseURL: this.baseURL,
          headers: this.client.defaults.headers,
          apiKey: this.apiKey ? 'Set' : 'Not set'
        });
      }

      const response = await this.client.request<T>({
        url: endpoint,
        ...options
      });

      this.costTracker.recordCost(estimatedCost);
      return response.data;
    } catch (error) {
      logger.error(`API call failed for ${this.serviceName}:`, {
        endpoint,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Add more detailed error logging
      if (axios.isAxiosError(error) && error.response) {
        logger.error('Response error details:', {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers
        });
      }
      throw error;
    }
  }

  private recordAPICall(endpoint: string, cost: number, success: boolean, responseTime: number): void {
    const record: APICallRecord = {
      service: this.serviceName,
      endpoint,
      cost,
      timestamp: new Date(),
      success,
      responseTime
    };

    // Log the API call for monitoring
    logger.debug(`API call recorded: ${this.serviceName}${endpoint} - ${success ? 'SUCCESS' : 'FAILED'} (${responseTime}ms)`);
    
    // Store for cost tracking
    this.costTracker.recordCost(cost);
  }

  abstract getServiceStatus(): Promise<boolean>;
}

// Rate limiting implementation
class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private timeWindow: number;
  private delayBetweenRequests: number;

  constructor(serviceName: string) {
    // Service-specific rate limits
    const limits = {
      'solsniffer': { maxRequests: 100, timeWindow: 60000, delay: 600 }, // 100/min, 600ms between
      'birdeye': { maxRequests: 200, timeWindow: 60000, delay: 300 }, // 200/min, 300ms between
      'dexscreener': { maxRequests: 300, timeWindow: 60000, delay: 200 }, // 300/min, 200ms between
      'moralis': { maxRequests: 100, timeWindow: 60000, delay: 600 }, // 100/min, 600ms between
      'helius': { maxRequests: 500, timeWindow: 60000, delay: 120 } // 500/min, 120ms between
    };

    const limit = limits[serviceName as keyof typeof limits] || { maxRequests: 60, timeWindow: 60000, delay: 1000 };
    this.maxRequests = limit.maxRequests;
    this.timeWindow = limit.timeWindow;
    this.delayBetweenRequests = limit.delay;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    
    // Remove old requests outside time window
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    
    // Check if we're at the limit
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.timeWindow - (now - oldestRequest);
      
      if (waitTime > 0) {
        logger.debug(`Rate limit reached, waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Add delay between requests
    if (this.requests.length > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayBetweenRequests));
    }

    this.requests.push(now);
  }

  handleRateLimit(): void {
    // Exponential backoff for rate limit responses
    this.delayBetweenRequests = Math.min(this.delayBetweenRequests * 2, 10000);
    logger.info(`Increased delay to ${this.delayBetweenRequests}ms for rate limiting`);
  }
}

// Cost tracking implementation
class CostTracker {
  private dailyCosts: Map<string, number> = new Map();
  private dailyLimits: Record<string, number> = {
    'solsniffer': 10, // $10/day
    'birdeye': 5,     // $5/day
    'moralis': 3,     // $3/day
    'dexscreener': 0, // Free
    'helius': 3       // $3/day (part of $99/month plan)
  };

  constructor(private serviceName: string) {}

  canMakeCall(estimatedCost: number): boolean {
    const today = new Date().toISOString().split('T')[0];
    const currentCost = this.dailyCosts.get(today) || 0;
    const limit = this.dailyLimits[this.serviceName] || 1;
    
    return (currentCost + estimatedCost) <= limit;
  }

  recordCost(cost: number): void {
    const today = new Date().toISOString().split('T')[0];
    const currentCost = this.dailyCosts.get(today) || 0;
    this.dailyCosts.set(today, currentCost + cost);
  }

  getDailyCost(): number {
    const today = new Date().toISOString().split('T')[0];
    return this.dailyCosts.get(today) || 0;
  }

  getRemainingBudget(): number {
    const limit = this.dailyLimits[this.serviceName] || 1;
    return Math.max(0, limit - this.getDailyCost());
  }
}



