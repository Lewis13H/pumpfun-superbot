import { Connection, ConnectionConfig, AccountInfo } from '@solana/web3.js';
import PQueue from 'p-queue';
import { logger } from './logger2';

export class RateLimitedConnection extends Connection {
    private queue: PQueue;
    private requestCount = 0;
    private windowStart = Date.now();

    constructor(endpoint: string, config?: ConnectionConfig) {
        super(endpoint, config);
        
        // 50 requests per second = 1 request every 20ms
        // Set to 45 req/sec to have some buffer
        this.queue = new PQueue({ 
            concurrency: 10,  // Max concurrent requests
            interval: 1000,   // Per 1 second
            intervalCap: 45   // Max 45 requests per second (leaving buffer)
        });

        // Log stats every 10 seconds
        setInterval(() => this.logStats(), 10000);
    }

    async getAccountInfo(...args: Parameters<Connection['getAccountInfo']>): Promise<AccountInfo<Buffer> | null> {
    return this.queue.add(async () => {
        this.requestCount++;
        try {
            return await super.getAccountInfo(...args);
        } catch (error: any) {
            if (error.message?.includes('429')) {
                logger.warn('Rate limit hit despite queue, backing off...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return await super.getAccountInfo(...args);
            }
            throw error;
        }
    }) as Promise<AccountInfo<Buffer> | null>;
}

    async getMultipleAccountsInfo(...args: Parameters<Connection['getMultipleAccountsInfo']>): Promise<(AccountInfo<Buffer> | null)[]> {
        return this.queue.add(async () => {
            this.requestCount++;
            try {
                return await super.getMultipleAccountsInfo(...args);
            } catch (error: any) {
                if (error.message?.includes('429')) {
                    logger.warn('Rate limit hit despite queue, backing off...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return await super.getMultipleAccountsInfo(...args);
                }
                throw error;
            }
        }) as Promise<(AccountInfo<Buffer> | null)[]>;
    }

    private logStats() {
        const elapsed = Date.now() - this.windowStart;
        const rps = (this.requestCount / elapsed) * 1000;
        logger.debug(`RPC Stats: ${this.requestCount} requests, ${rps.toFixed(1)} req/sec`);
        
        // Reset counters every minute
        if (elapsed > 60000) {
            this.requestCount = 0;
            this.windowStart = Date.now();
        }
    }
}

// Singleton instance
let connection: RateLimitedConnection | null = null;

export function getRateLimitedConnection(): RateLimitedConnection {
    if (!connection) {
        const heliusUrl = process.env.HELIUS_RPC_URL;
        if (!heliusUrl) {
            throw new Error('HELIUS_RPC_URL not configured');
        }
        
        connection = new RateLimitedConnection(heliusUrl, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000
        });
        
        logger.info('Rate-limited RPC connection initialized (45 req/sec)');
    }
    
    return connection;
}

