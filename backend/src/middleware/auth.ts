import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/auth';
import { getStore } from '../store';

export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Not authenticated', errorCode: 'NO_TOKEN' });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token', errorCode: 'INVALID_TOKEN' });
  }
}

export function requireRole(...roles: Array<'citizen' | 'admin'>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions', errorCode: 'FORBIDDEN' });
    }
    next();
  };
}

export async function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  next();
}
