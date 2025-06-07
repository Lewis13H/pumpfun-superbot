// src/api/websocket/websocket-manager.ts
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { logger } from '../../utils/logger';
import { db } from '../../database/postgres';

export class WebSocketManager {
  private io: Server;
  private connectedClients: Map<string, any> = new Map();

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: "http://localhost:3001",
        methods: ["GET", "POST"]
      }
    });

    this.setupEventHandlers();
    this.setupPeriodicUpdates();
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);
      this.connectedClients.set(socket.id, { socket, subscribedChannels: new Set() });

      // Send initial connection confirmation
      socket.emit('connected', { message: 'Connected to WebSocket server' });

      // Handle subscriptions
      socket.on('subscribe', (channels: string[]) => {
        const client = this.connectedClients.get(socket.id);
        if (client) {
          channels.forEach(channel => client.subscribedChannels.add(channel));
          logger.info(`Client ${socket.id} subscribed to: ${channels.join(', ')}`);
        }
      });

      // Handle unsubscribe
      socket.on('unsubscribe', (channels: string[]) => {
        const client = this.connectedClients.get(socket.id);
        if (client) {
          channels.forEach(channel => client.subscribedChannels.delete(channel));
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });
    });
  }

  private setupPeriodicUpdates() {
    // Periodic stats update
    setInterval(() => {
      this.broadcastDiscoveryStats();
    }, 5000); // Every 5 seconds

    // Periodic API monitor update
    setInterval(() => {
      this.broadcastApiStatus();
    }, 10000); // Every 10 seconds
  }

  // Method to emit new token discoveries from gRPC
  public emitNewToken(token: any) {
    this.broadcast('new-token', {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      platform: 'pump.fun',
      createdAt: token.createdAt,
      discoveredAt: new Date(),
      marketCap: token.marketCap || 0,
      current_price: token.current_price || 0,
      priceChange24h: 0,
      volume24h: 0,
      liquidity: token.liquidity || 0,
      holders: 0,
      safetyScore: 0,
      potentialScore: 0,
      compositeScore: 0,
      investmentClassification: 'STANDARD',
      analysisStatus: 'PENDING'
    });
  }

  // Method to emit token updates
  public async emitTokenUpdate(tokenAddress: string) {
    const updatedToken = await db('tokens')
      .where('address', tokenAddress)
      .first();

    if (updatedToken) {
      this.broadcast('token-update', {
        address: updatedToken.address,
        marketCap: Number(updatedToken.market_cap || 0),
        current_price: Number(updatedToken.current_price_usd || 0),
        priceChange24h: Number(updatedToken.price_change_24h || 0),
        volume24h: Number(updatedToken.volume_24h || 0),
        liquidity: Number(updatedToken.liquidity || 0),
        safetyScore: Number(updatedToken.safety_score || 0),
        potentialScore: Number(updatedToken.potential_score || 0),
        compositeScore: Number(updatedToken.composite_score || 0),
        investmentClassification: updatedToken.investment_classification,
        analysisStatus: updatedToken.analysis_status
      });
    }
  }

  private async broadcastDiscoveryStats() {
    try {
      // Get stats from database instead of discoveryService
      const [
        totalTokens,
        recentTokens,
        activeTokens
      ] = await Promise.all([
        db('tokens').count('* as count').first(),
        db('tokens')
          .where('created_at', '>', new Date(Date.now() - 3600000)) // Last hour
          .count('* as count')
          .first(),
        db('tokens')
          .where('category', 'IN', ['HIGH', 'AIM'])
          .count('* as count')
          .first()
      ]);

      const stats = {
        tokensDiscovered: Number(totalTokens?.count || 0),
        tokensLastHour: Number(recentTokens?.count || 0),
        activeTokens: Number(activeTokens?.count || 0),
        currentRate: Number(recentTokens?.count || 0) / 60 // Per minute
      };

      this.broadcast('discovery-stats', {
        type: 'stats',
        stats
      });
    } catch (error) {
      logger.error('Error broadcasting discovery stats:', error);
    }
  }

  private async broadcastApiStatus() {
    // This would integrate with your actual API monitoring
    this.broadcast('api-monitor', {
      type: 'service-status',
      services: [
        {
          name: 'SolSniffer',
          status: 'operational',
          responseTime: 200 + Math.random() * 100,
          successRate: 95 + Math.random() * 5
        },
        {
          name: 'Birdeye',
          status: 'operational',
          responseTime: 150 + Math.random() * 50,
          successRate: 97 + Math.random() * 3
        },
        {
          name: 'DexScreener',
          status: 'operational',
          responseTime: 100 + Math.random() * 50,
          successRate: 99 + Math.random() * 1
        },
        {
          name: 'gRPC Stream',
          status: 'operational',
          responseTime: 50 + Math.random() * 20,
          successRate: 99.5 + Math.random() * 0.5
        }
      ]
    });
  }

  public emitSignal(signal: any) {
    this.broadcast('new-signal', {
      tokenAddress: signal.token_address,
      tokenSymbol: signal.symbol,
      type: signal.signal_type || signal.type,
      confidence: signal.confidence,
      strategy: signal.strategy,
      timestamp: signal.generated_at
    });
  }

  public emitApiError(service: string, error: string, severity: 'low' | 'medium' | 'high') {
    this.broadcast('api-monitor', {
      type: 'error',
      error: {
        id: Date.now().toString(),
        service,
        error,
        timestamp: new Date().toISOString(),
        severity
      }
    });
  }

  public emitCostUpdate(totalCost: number) {
    this.broadcast('api-monitor', {
      type: 'cost-update',
      totalCost
    });
  }

  private broadcast(channel: string, data: any) {
    this.connectedClients.forEach((client) => {
      if (client.subscribedChannels.has(channel) || channel === 'connected') {
        client.socket.emit(channel, data);
      }
    });
  }

  public getIO(): Server {
    return this.io;
  }
}