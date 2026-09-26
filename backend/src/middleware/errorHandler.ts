import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';

export class ApiError extends Error {
  status: number;
  errorCode: string;
  constructor(status: number, message: string, errorCode = 'ERROR') {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}`, errorCode: 'NOT_FOUND' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ success: false, message: 'Validation failed: ' + err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), errorCode: 'VALIDATION_ERROR', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  const status = err instanceof ApiError ? err.status : (err.status || 500);
  const errorCode = err instanceof ApiError ? err.errorCode : (err.errorCode || 'INTERNAL_ERROR');
  if (!isProduction) {
    console.error(err);
  }
  res.status(status).json({
    success: false,
    message: err.message || 'An unexpected error occurred',
    errorCode,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);
}
