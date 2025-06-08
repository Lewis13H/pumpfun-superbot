import { Server, Socket } from 'socket.io';
import { logger } from '../../utils/logger2';

export function setupWebSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    logger.info(`Client connected: ${socket.id}`);

    // Handle authentication
    socket.on('auth', (data) => {
      // Verify token
      socket.data.authenticated = true;
      socket.emit('auth:success');
    });

    // Handle subscriptions
    socket.on('subscribe', (channels: string[]) => {
      channels.forEach(channel => {
        socket.join(channel);
        logger.info(`Client ${socket.id} subscribed to ${channel}`);
      });
    });

    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });
  });

  // Start emitting updates
  startRealtimeUpdates(io);
}

function startRealtimeUpdates(io: Server) {
  // Emit token updates every 5 seconds
  setInterval(() => {
    io.to('tokens').emit('message', {
      channel: 'tokens',
      event: 'update',
      data: {
        // Your token data here
      }
    });
  }, 5000);

  // Emit metrics every 10 seconds
  setInterval(() => {
    io.to('metrics').emit('message', {
      channel: 'metrics',
      event: 'update',
      data: {
        discoveryRate: 960,
        successRate: 0.952,
        apiCost: 15.42
      }
    });
  }, 10000);
}
