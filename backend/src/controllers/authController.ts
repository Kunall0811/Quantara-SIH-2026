import { Request, Response } from 'express';
import { z } from 'zod';
import { getStore } from '../store';
import { hashPassword, verifyPassword, hashOtp, verifyOtp, generateOtpCode, signToken } from '../utils/auth';
import { sendOtpEmail, emailConfigured } from '../services/emailService';
import { ApiError, asyncHandler } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const body = registerSchema.parse(req.body);
  const store = getStore();
  const existing = await store.findUserByEmail(body.email);
  if (existing) throw new ApiError(400, 'An account with this email already exists', 'EMAIL_TAKEN');

  const passwordHash = await hashPassword(body.password);
  const user = await store.createUser({
    name: body.name, email: body.email.toLowerCase(), passwordHash, role: 'citizen', emailVerified: false,
  });

  const code = generateOtpCode();
  await store.createOtp({
    email: user.email, hashedCode: hashOtp(code), purpose: 'verify_email',
    maxAttempts: 5, expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  const emailResult = await sendOtpEmail(user.email, code, 'verify_email');
  await store.writeAudit({ userId: user.id, action: 'REGISTER', details: { email: user.email } });

  res.json({
    success: true,
    message: emailConfigured()
      ? 'Account created. Check your email for a verification code.'
      : 'Account created. Email delivery is not configured, so the code is shown below for testing.',
    userId: user.id,
    emailDelivered: emailResult.delivered,
    devOtp: emailResult.devCode,
  });
});

const verifyOtpSchema = z.object({ email: z.string().email(), code: z.string().length(6) });

export const verifyOtpHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, code } = verifyOtpSchema.parse(req.body);
  const store = getStore();
  const otp = await store.findLatestOtp(email, 'verify_email');
  if (!otp) throw new ApiError(400, 'No pending verification code found', 'OTP_NOT_FOUND');
  if (otp.expiresAt.getTime() < Date.now()) throw new ApiError(400, 'Code has expired', 'OTP_EXPIRED');
  if (otp.attempts >= otp.maxAttempts) throw new ApiError(429, 'Too many attempts. Request a new code.', 'OTP_LOCKED');

  if (!verifyOtp(code, otp.hashedCode)) {
    await store.incrementOtpAttempts(otp.id);
    throw new ApiError(400, 'Incorrect code', 'OTP_INVALID');
  }
  await store.consumeOtp(otp.id);
  const user = await store.findUserByEmail(email);
  if (!user) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  await store.setEmailVerified(user.id);
  res.json({ success: true, message: 'Email verified successfully.' });
});

const resendSchema = z.object({ email: z.string().email(), purpose: z.enum(['verify_email', 'reset_password']).default('verify_email') });
const lastSendAt = new Map<string, number>();

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, purpose } = resendSchema.parse(req.body);
  const key = `${email}:${purpose}`;
  const last = lastSendAt.get(key) || 0;
  if (Date.now() - last < OTP_RESEND_COOLDOWN_MS) {
    throw new ApiError(429, 'Please wait before requesting another code', 'OTP_COOLDOWN');
  }
  const store = getStore();
  const user = await store.findUserByEmail(email);
  if (purpose === 'reset_password' && !user) {
    // Do not reveal whether the email exists.
    return res.json({ success: true, message: 'If that email exists, a code has been sent.' });
  }
  const code = generateOtpCode();
  await store.createOtp({
    email: email.toLowerCase(), hashedCode: hashOtp(code), purpose,
    maxAttempts: 5, expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  const result = await sendOtpEmail(email, code, purpose);
  lastSendAt.set(key, Date.now());
  res.json({ success: true, message: 'Code sent.', emailDelivered: result.delivered, devOtp: result.devCode });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);
  const store = getStore();
  const user = await store.findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }
  const token = signToken({ sub: user.id, role: user.role });
  await store.writeAudit({ userId: user.id, action: 'LOGIN', details: {} });
  res.json({
    success: true,
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified },
  });
});

export const me = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const user = await store.findUserById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified } });
});

const resetSchema = z.object({ email: z.string().email(), code: z.string().length(6), newPassword: z.string().min(6) });

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email, code, newPassword } = resetSchema.parse(req.body);
  const store = getStore();
  const otp = await store.findLatestOtp(email, 'reset_password');
  if (!otp) throw new ApiError(400, 'No pending reset code found', 'OTP_NOT_FOUND');
  if (otp.expiresAt.getTime() < Date.now()) throw new ApiError(400, 'Code has expired', 'OTP_EXPIRED');
  if (!verifyOtp(code, otp.hashedCode)) {
    await store.incrementOtpAttempts(otp.id);
    throw new ApiError(400, 'Incorrect code', 'OTP_INVALID');
  }
  const user = await store.findUserByEmail(email);
  if (!user) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  await store.consumeOtp(otp.id);
  await store.updatePassword(user.id, await hashPassword(newPassword));
  res.json({ success: true, message: 'Password updated. You can now log in.' });
});
