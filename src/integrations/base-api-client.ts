// src/integrations/base-api-client.ts
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { logger } from '../utils/logger';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  retryAfter?: number;
}

interface RequestQueueItem {
  request: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

export abstract class BaseAPIClient {
  protected client: AxiosInstance;
  protected rateLimitConfig: RateLimitConfig;
  protected requestQueue: RequestQueueItem[] = [];
  protected requestHistory: number[] = [];
  protected isProcessing: boolean = false;
  protected name: string;

  constructor(
    name: string,
    baseURL: string,
    rateLimitConfig: RateLimitConfig,
    axiosConfig?: AxiosRequestConfig
  ) {
    this.name = name;
    this.rateLimitConfig = rateLimitConfig;
    
    this.client = axios.create({
      baseURL,
      timeout: 10000,
      ...axiosConfig,
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 429) {
          logger.warn(`${this.name} rate limit hit`, {
            headers: error.response.headers,
          });
          
          // Handle rate limit with exponential backoff
          const retryAfter = this.parseRetryAfter(error.response.headers);
          await this.delay(retryAfter);
          
          // Retry the request
          return this.client.request(error.config);
        }
        
        return Promise.reject(error);
      }
    );

    // Start queue processor
    this.startQueueProcessor();
  }

  protected async makeRequest<T>(
    config: AxiosRequestConfig,
    priority: number = 0
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const queueItem: RequestQueueItem = {
        request: async () => {
          // Clean old request history
          this.cleanRequestHistory();
          
          // Check rate limit
          if (!this.canMakeRequest()) {
            const waitTime = this.getWaitTime();
            logger.debug(`${this.name} rate limit wait: ${waitTime}ms`);
            await this.delay(waitTime);
          }
          
          // Record request time
          this.requestHistory.push(Date.now());
          
          try {
            const response = await this.client.request<T>(config);
            return response.data;
          } catch (error) {
            logger.error(`${this.name} request failed:`, {
              url: config.url,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
          }
        },
        resolve,
        reject,
        timestamp: Date.now() - priority * 1000, // Priority affects timestamp
      };

      this.requestQueue.push(queueItem);
      
      // Sort by timestamp (oldest first, but priority can override)
      this.requestQueue.sort((a, b) => a.timestamp - b.timestamp);
    });
  }

  private startQueueProcessor(): void {
    setInterval(async () => {
      if (this.isProcessing || this.requestQueue.length === 0) return;
      
      this.isProcessing = true;
      
      while (this.requestQueue.length > 0 && this.canMakeRequest()) {
        const item = this.requestQueue.shift();
        if (!item) break;
        
        try {
          const result = await item.request();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
        
        // Small delay between requests
        await this.delay(100);
      }
      
      this.isProcessing = false;
    }, 100);
  }

  private canMakeRequest(): boolean {
    this.cleanRequestHistory();
    return this.requestHistory.length < this.rateLimitConfig.maxRequests;
  }

  private cleanRequestHistory(): void {
    const cutoff = Date.now() - this.rateLimitConfig.windowMs;
    this.requestHistory = this.requestHistory.filter(time => time > cutoff);
  }

  private getWaitTime(): number {
    if (this.requestHistory.length === 0) return 0;
    
    const oldestRequest = Math.min(...this.requestHistory);
    const timeUntilOldestExpires = 
      (oldestRequest + this.rateLimitConfig.windowMs) - Date.now();
    
    return Math.max(0, timeUntilOldestExpires);
  }

  private parseRetryAfter(headers: any): number {
    const retryAfter = headers['retry-after'];
    if (!retryAfter) return this.rateLimitConfig.retryAfter || 60000;
    
    // Check if it's seconds or a date
    const parsed = parseInt(retryAfter);
    if (!isNaN(parsed)) {
      return parsed * 1000; // Convert seconds to ms
    }
    
    // Try to parse as date
    const retryDate = new Date(retryAfter);
    if (!isNaN(retryDate.getTime())) {
      return Math.max(0, retryDate.getTime() - Date.now());
    }
    
    return this.rateLimitConfig.retryAfter || 60000;
  }

  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getQueueSize(): number {
    return this.requestQueue.length;
  }

  getRateLimitStatus(): {
    requestsInWindow: number;
    maxRequests: number;
    windowMs: number;
  } {
    this.cleanRequestHistory();
    return {
      requestsInWindow: this.requestHistory.length,
      maxRequests: this.rateLimitConfig.maxRequests,
      windowMs: this.rateLimitConfig.windowMs,
    };
  }
}