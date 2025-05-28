import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config } from '../config';
import { logger } from '../utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { setupWebSocket } from './websocket/socketHandler';
import apiRoutes from './routes';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3001", // Your frontend URL
    methods: ["GET", "POST"]
  }
});
// After creating io
setupWebSocket(io);

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(requestLogger);
app.use('/api', apiRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.use(errorHandler);

// Start server
//const PORT = config.port || 3000;
//httpServer.listen(PORT, () => {
//  logger.info(`API Server running on port ${PORT}`);
//});

export { app, io, httpServer };