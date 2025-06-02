// src/api/websocket/websocket-manager.ts
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { logger } from '../../utils/logger';
import { discoveryService } from '../../discovery/discovery-service';
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
    this.setupDiscoveryListeners();
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

  private setupDiscoveryListeners() {
    // Listen to discovery service events
    const discoveryManager = (discoveryService as any).discoveryManager;
    
    // New token discovered
    discoveryManager.on('tokenDiscovered', async (token: any) => {
      this.broadcast('new-token', {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        createdAt: token.createdAt,
        discoveredAt: new Date(),
        marketCap: 0,
        current_price: 0,
        priceChange24h: 0,
        volume24h: 0,
        liquidity: 0,
        holders: 0,
        safetyScore: 0,
        potentialScore: 0,
        compositeScore: 0,
        investmentClassification: 'STANDARD',
        analysisStatus: 'PENDING'
      });
    });

    // Token analysis completed
    const tokenProcessor = (discoveryService as any).tokenProcessor;
    tokenProcessor.on('tokenReady', async (token: any) => {
      // Fetch updated token data
      const updatedToken = await db('tokens')
        .where('address', token.address)
        .first();

      if (updatedToken) {
        this.broadcast('token-update', {
          address: updatedToken.address,
          marketCap: Number(updatedToken.market_cap || 0),
          current_price: Number(updatedToken.price || 0),
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
    });

    // Periodic stats update
    setInterval(() => {
      this.broadcastDiscoveryStats();
    }, 5000); // Every 5 seconds

    // Periodic API monitor update
    setInterval(() => {
      this.broadcastApiStatus();
    }, 10000); // Every 10 seconds
  }

  private async broadcastDiscoveryStats() {
    const stats = discoveryService.getStats();
    this.broadcast('discovery-stats', {
      type: 'stats',
      stats
    });
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
        // Add other services...
      ]
    });
  }

  public emitSignal(signal: any) {
    this.broadcast('new-signal', {
      tokenAddress: signal.token_address,
      tokenSymbol: signal.symbol,
      type: signal.signal_type,
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
