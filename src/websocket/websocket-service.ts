// src/websocket/websocket-service.ts

import { Server } from 'socket.io';
import { createServer } from 'http';
import { logger } from '../utils/logger2';

export interface WebSocketClient {
  id: string;
  subscriptions: Set<string>;
}

export class WebSocketService {
  private io: Server;
  private httpServer: any;
  private clients: Map<string, WebSocketClient> = new Map();
  private port: number;
  
  constructor(port: number = 8080) {
    this.port = port;
    this.httpServer = createServer();
    this.io = new Server(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    
    this.setupHandlers();
  }
  
  private setupHandlers(): void {
    this.io.on('connection', (socket) => {
      const client: WebSocketClient = {
        id: socket.id,
        subscriptions: new Set()
      };
      
      this.clients.set(socket.id, client);
      logger.info(`WebSocket client connected: ${socket.id}`);
      
      // Handle subscriptions
      socket.on('subscribe', (channels: string[]) => {
        channels.forEach(channel => {
          client.subscriptions.add(channel);
          socket.join(channel);
        });
        
        socket.emit('subscribed', channels);
      });
      
      socket.on('unsubscribe', (channels: string[]) => {
        channels.forEach(channel => {
          client.subscriptions.delete(channel);
          socket.leave(channel);
        });
        
        socket.emit('unsubscribed', channels);
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        this.clients.delete(socket.id);
        logger.info(`WebSocket client disconnected: ${socket.id}`);
      });
      
      // Send initial status
      socket.emit('connected', {
        timestamp: new Date(),
        clientId: socket.id
      });
    });
  }
  
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        logger.info(`WebSocket server listening on port ${this.port}`);
        resolve();
      });
    });
  }
  
  async stop(): Promise<void> {
    this.io.close();
    this.httpServer.close();
    logger.info('WebSocket server stopped');
  }
  
  broadcast(event: string, data: any): void {
    this.io.emit(event, {
      ...data,
      timestamp: new Date()
    });
  }
  
  broadcastToChannel(channel: string, event: string, data: any): void {
    this.io.to(channel).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }
  
  getClientCount(): number {
    return this.clients.size;
  }
}
