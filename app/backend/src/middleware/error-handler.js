import { logger } from '../logger.js';

export function notFound(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

// Express recognises error handlers by their four parameters.
export function errorHandler(err, req, res, _next) {
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }

  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.originalUrl });
  }
  return res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
}
