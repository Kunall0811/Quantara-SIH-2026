import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
export function hashOtp(code: string): string {
  // OTPs are short-lived and low-entropy, so a fast synchronous hash is
  // fine here (bcrypt is used for the higher-value password hashes above).
  return bcrypt.hashSync(code, 6);
}
export function verifyOtp(code: string, hash: string): boolean {
  return bcrypt.compareSync(code, hash);
}

export interface JwtPayload {
  sub: string;
  role: 'citizen' | 'admin';
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
