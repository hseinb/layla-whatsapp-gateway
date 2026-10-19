import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  // If API key is not configured, allow access
  if (!config.apiKey) {
    return next();
  }

  // Extract from Authorization header (Bearer token), X-API-Key header, or query param
  const authHeader = req.headers.authorization;
  const headerKey = req.headers['x-api-key'] as string;
  const queryKey = req.query.apiKey as string;

  let providedKey = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7).trim();
  } else if (headerKey) {
    providedKey = headerKey.trim();
  } else if (queryKey) {
    providedKey = queryKey.trim();
  }

  if (!providedKey || providedKey !== config.apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing API key',
    });
  }

  next();
}
