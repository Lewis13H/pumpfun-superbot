import WebSocket from 'ws';
import axios from 'axios';
import { BaseMonitor, TokenDiscovery } from './base-monitor';
import { config } from '../config';
import { logger } from '../utils/logger';
import { PumpFunToken } from './types';

export class PumpFunMonitor extends BaseMonitor {
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private httpPollInterval: NodeJS.Timeout | null = null;

  constructor() {
    super('PumpFun');
  }

  protected async startMonitoring(): Promise<void> {
    // Start WebSocket connection
    await this.connectWebSocket();
    
    // Start HTTP polling as backup
    this.startHttpPolling();
  }

  protected async stopMonitoring(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.httpPollInterval) {
      clearInterval(this.httpPollInterval);
      this.httpPollInterval = null;
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(config.discovery.pumpfunWsUrl);

      this.ws.on('open', () => {
        logger.info('PumpFun WebSocket connected');
        
        // Subscribe to token events
        this.ws!.send(JSON.stringify({
          method: 'subscribeTokenCreation',
        }));

        // Set up ping to keep connection alive
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 30000);

        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.error('Failed to parse PumpFun message:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        logger.error('PumpFun WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.warn(`PumpFun WebSocket closed: ${code} - ${reason.toString()}`);
        this.handleReconnect();
      });

      this.ws.on('pong', () => {
        logger.debug('PumpFun WebSocket pong received');
      });
    });
  }

  private handleMessage(message: any): void {
    if (message.type === 'tokenCreate' || message.type === 'create') {
      const tokenData = message.data || message;
      
      const token: TokenDiscovery = {
        address: tokenData.mint || tokenData.address,
        symbol: tokenData.symbol,
        name: tokenData.name,
        platform: 'pumpfun',
        createdAt: new Date(tokenData.created_timestamp || Date.now()),
        metadata: {
          creator: tokenData.creator,
          description: tokenData.description,
          imageUri: tokenData.image_uri,
          bondingCurve: tokenData.bonding_curve,
          marketCap: tokenData.usd_market_cap,
        },
      };

      this.emitTokenDiscovery(token);
    }
  }

  private startHttpPolling(): void {
    // Poll every 30 seconds as backup
    this.httpPollInterval = setInterval(async () => {
      await this.pollRecentTokens();
    }, 30000);

    // Initial poll
    this.pollRecentTokens();
  }

  private async pollRecentTokens(): Promise<void> {
    try {
      const response = await axios.get(
        `${config.discovery.pumpfunApiUrl}/coins/recently-created`,
        {
          params: { limit: 50 },
          timeout: 10000,
        }
      );

      const tokens: PumpFunToken[] = response.data;
      
      for (const tokenData of tokens) {
        const token: TokenDiscovery = {
          address: tokenData.mint,
          symbol: tokenData.symbol,
          name: tokenData.name,
          platform: 'pumpfun',
          createdAt: new Date(tokenData.created_timestamp),
          metadata: {
            creator: tokenData.creator,
            description: tokenData.description,
            imageUri: tokenData.image_uri,
            bondingCurve: tokenData.bonding_curve,
            marketCap: tokenData.usd_market_cap,
          },
        };

        this.emitTokenDiscovery(token);
      }

      logger.debug(`Polled ${tokens.length} tokens from PumpFun API`);
    } catch (error: any) {
      // Log concise error message instead of full object
      if (error.response?.status === 503) {
        logger.warn('PumpFun API is temporarily unavailable (503)');
      } else {
        logger.error('PumpFun HTTP polling error:', {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText
        });
      }
    }
  }
}