import express from 'express';
import cors from 'cors';

import { config } from './config.js';
import { logger } from './logger.js';
import { statusRouter } from './routes/status.routes.js';
import { messageRouter } from './routes/message.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { whatsappClient } from './whatsapp/client.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  if (!req.path.startsWith('/health') && !req.path.startsWith('/auth/qr')) {
    logger.info({ method: req.method, path: req.path, ip: req.ip }, 'Incoming request');
  }
  next();
});

// Mount routes
app.use('/', statusRouter);
app.use('/api/messages', messageRouter);

// Error handler
app.use(errorHandler);

// Start HTTP server & WhatsApp client
const server = app.listen(config.port, config.host, () => {
  logger.info(`========================================================`);
  logger.info(`🚀 Layla WhatsApp Daemon running on http://${config.host}:${config.port}`);
  logger.info(`📱 Device Pairing Dashboard: http://localhost:${config.port}/auth/qr`);
  logger.info(`🛡️ API Key Auth: ${config.apiKey ? 'Enabled' : 'Disabled (Open)'}`);
  logger.info(`⚡ Webhook URL: ${config.webhookUrl || 'Not configured'}`);
  logger.info(`========================================================`);

  // Start WhatsApp client connection
  whatsappClient.start().catch((err) => {
    logger.error({ err }, 'Failed to start WhatsApp client');
  });
});

// Handle graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down Layla WhatsApp Daemon gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });

  // Force exit after 10s if dangling
  setTimeout(() => {
    logger.warn('Forcing exit after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
