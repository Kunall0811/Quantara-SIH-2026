import nodemailer from 'nodemailer';
import { env } from '../config/env';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

export function emailConfigured(): boolean {
  return !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
}

/**
 * Sends the OTP by Gmail SMTP when configured. When it isn't (the common
 * case for a fresh clone with no Gmail app password yet), the OTP is
 * logged to the server console and - only outside production - returned
 * in the API response, so registration/login can be fully tested without
 * setting up email first.
 */
export async function sendOtpEmail(to: string, code: string, purpose: string): Promise<{ delivered: boolean; devCode?: string }> {
  const t = getTransporter();
  if (!t) {
    console.log(`[email] SMTP not configured — OTP for ${to} (${purpose}): ${code}`);
    return { delivered: false, devCode: env.DEV_EXPOSE_OTP ? code : undefined };
  }
  try {
    await t.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: purpose === 'reset_password' ? 'Q-ROUTE INDIA — Password Reset Code' : 'Q-ROUTE INDIA — Verify your email',
      text: `Your Q-ROUTE INDIA verification code is ${code}. It expires in 10 minutes.`,
      html: `<div style="font-family:sans-serif"><h2>Q-ROUTE INDIA</h2><p>Your verification code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
        <p style="color:#666">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p></div>`,
    });
    return { delivered: true };
  } catch (err: any) {
    console.warn(`[email] Failed to send via Gmail SMTP (${err.message}) — OTP for ${to}: ${code}`);
    return { delivered: false, devCode: env.DEV_EXPOSE_OTP ? code : undefined };
  }
}
