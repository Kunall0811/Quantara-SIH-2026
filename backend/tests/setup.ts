/**
 * Hermetic test environment: never talk to real providers / SMTP / MongoDB,
 * regardless of what a developer has in backend/.env.
 */
import os from 'os';
import path from 'path';
const blank = ['MONGODB_URI', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'TOMTOM_API_KEY', 'ELEVENLABS_API_KEY', 'ASSEMBLYAI_API_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'SMTP_USER', 'SMTP_PASS'];
for (const k of blank) process.env[k] = '';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32chars!';
process.env.TRAFFIC_PROVIDER = 'simulation';
process.env.ROUTING_OFFLINE = 'true';
process.env.TWIN_BACKGROUND_DRIFT = 'false';
process.env.DATA_DIR = path.join(os.tmpdir(), `quantara-test-${process.pid}`);
process.env.DEV_EXPOSE_OTP = 'true';
