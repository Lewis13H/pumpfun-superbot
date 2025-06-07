// src/api/server.ts - Exports the Express app for use in index.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import apiRoutes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

// Create and configure Express app
export const app = express();

// Setup middleware
app.use(helmet());
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handling
app.use(errorHandler);

// You can optionally export the ApiServer class if needed elsewhere
export class ApiServer {
  private app: express.Application;
  private port: number;

  constructor(port: number) {
    this.app = app;
    this.port = port;
  }

  getApp(): express.Application {
    return this.app;
  }
}
