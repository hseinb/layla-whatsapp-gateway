import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  logger.error({ err: err?.message || err, stack: err?.stack }, 'Unhandled API error');

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
}
