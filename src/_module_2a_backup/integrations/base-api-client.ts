import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { logger } from '../utils/logger';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  retryAfter?: number;
}

export interface APIClientConfig {
  baseURL: string;
  apiKey?: string;
  timeout?: number;
  rateLimit?: RateLimitConfig;
  headers?: Record<string, string>;
}

export class BaseAPIClient {
  protected client: AxiosInstance;
  protected name: string;
  private requestTimes: number[] = [];
  private rateLimitConfig: RateLimitConfig;
  private retryQueue: Map<string, NodeJS.Timeout> = new Map();

  constructor(name: string, config: APIClientConfig) {
    this.name = name;
    this.rateLimitConfig = config.rateLimit || {
      maxRequests: 60,
      windowMs: 60000, // 1 minute
      retryAfter: 1000,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    if (config.apiKey) {
      // Different APIs use different header names
      if (name === 'birdeye') {
        headers['X-API-KEY'] = config.apiKey;
      } else if (name === 'moralis') {
        headers['X-API-Key'] = config.apiKey;
      } else {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }
    }

    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 10000,
      headers,
    });

    // Add request interceptor for rate limiting
    this.client.interceptors.request.use(
      async (config) => {
        await this.checkRateLimit();
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        return this.handleError(error);
      }
    );
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.rateLimitConfig.windowMs;

    // Remove old request times
    this.requestTimes = this.requestTimes.filter(time => time > windowStart);

    // Check if we're at the limit
    if (this.requestTimes.length >= this.rateLimitConfig.maxRequests) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = oldestRequest + this.rateLimitConfig.windowMs - now;
      
      if (waitTime > 0) {
        logger.warn(`${this.name} rate limit reached, waiting ${waitTime}ms`);
        await this.delay(waitTime);
      }
    }

    // Record this request
    this.requestTimes.push(now);
  }

  private async handleError(error: AxiosError): Promise<any> {
    const status = error.response?.status;
    
    if (status === 429) {
      // Rate limit error
      const retryAfter = this.extractRetryAfter(error) || this.rateLimitConfig.retryAfter || 5000;
      logger.warn(`${this.name} rate limited, retrying after ${retryAfter}ms`);
      
      await this.delay(retryAfter);
      return this.client.request(error.config!);
    }

    if (status === 503 || status === 502 || status === 504) {
      // Service unavailable, bad gateway, or timeout
      logger.warn(`${this.name} service unavailable (${status}), retrying...`);
      
      await this.delay(2000);
      return this.client.request(error.config!);
    }

    // For 400 errors, log but don't retry
    if (status === 400) {
      logger.debug(`${this.name} bad request:`, {
        url: error.config?.url,
        params: error.config?.params,
        response: error.response?.data
      });
    } else {
      // Log other errors
      logger.error(`${this.name} API error:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
        url: error.config?.url,
      });
    }

    throw error;
  }

  private extractRetryAfter(error: AxiosError): number | null {
    const retryAfter = error.response?.headers['retry-after'];
    if (!retryAfter) return null;

    // If it's a number, it's seconds
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }

    // If it's a date, calculate the difference
    const retryDate = new Date(retryAfter);
    if (!isNaN(retryDate.getTime())) {
      return Math.max(0, retryDate.getTime() - Date.now());
    }

    return null;
  }

  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected async get<T>(endpoint: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.get<T>(endpoint, config);
      return response.data;
    } catch (error) {
      // Error already handled by interceptor
      throw error;
    }
  }

  protected async post<T>(endpoint: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.post<T>(endpoint, data, config);
      return response.data;
    } catch (error) {
      // Error already handled by interceptor
      throw error;
    }
  }

  getStats() {
    const now = Date.now();
    const windowStart = now - this.rateLimitConfig.windowMs;
    const recentRequests = this.requestTimes.filter(time => time > windowStart);

    return {
      name: this.name,
      requestsInWindow: recentRequests.length,
      maxRequests: this.rateLimitConfig.maxRequests,
      windowMs: this.rateLimitConfig.windowMs,
    };
  }
}