import dotenv from 'dotenv';
dotenv.config();

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // --- Database ---
  // If MONGODB_URI is unset/unreachable, the backend automatically falls
  // back to a fully-functional in-memory data store (see src/store) so the
  // project runs immediately with zero setup. Set a real Atlas URI here for
  // persistent storage.
  MONGODB_URI: process.env.MONGODB_URI || '',

  // --- Auth ---
  JWT_SECRET: process.env.JWT_SECRET || 'dev_only_insecure_secret_change_me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',

  // --- Groq (FRIDAY AI) - optional, free tier available ---
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

  // --- TomTom (primary routing/traffic/geocoding) - optional, free tier ---
  TOMTOM_API_KEY: process.env.TOMTOM_API_KEY || '',
  TOMTOM_BASE_URL: process.env.TOMTOM_BASE_URL || 'https://api.tomtom.com',

  // --- OSRM fallback (free public demo server, or self-hosted) ---
  OSRM_BASE_URL: process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',

  // --- Weather (free, no key) ---
  OPEN_METEO_BASE_URL: process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com',

  // --- Geocoding fallback (free, no key) ---
  NOMINATIM_BASE_URL: process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',

  // --- Voice (all optional; browser is the free default) ---
  STT_PROVIDER: process.env.STT_PROVIDER || 'browser',
  TTS_PROVIDER: process.env.TTS_PROVIDER || 'browser',
  ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY || '',
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
  ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
  CHATTERBOX_TTS_URL: process.env.CHATTERBOX_TTS_URL || '',

  // --- Gmail SMTP (OTP) - optional; falls back to console-logged OTP in dev ---
  GMAIL_USER: process.env.GMAIL_USER || process.env.SMTP_USER || '',
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '',
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_FROM: process.env.SMTP_FROM || process.env.GMAIL_USER || 'no-reply@qroute.in',

  // --- Provider selection ---
  MAP_PROVIDER: process.env.MAP_PROVIDER || 'osm',
  ROUTING_PROVIDER: process.env.ROUTING_PROVIDER || 'tomtom',
  ROUTING_FALLBACK: process.env.ROUTING_FALLBACK || 'osrm',
  TRAFFIC_PROVIDER: process.env.TRAFFIC_PROVIDER || 'tomtom',
  TRAFFIC_FALLBACK: process.env.TRAFFIC_FALLBACK || 'simulation',
  WEATHER_PROVIDER: process.env.WEATHER_PROVIDER || 'open-meteo',
  GEOCODING_PROVIDER: process.env.GEOCODING_PROVIDER || 'tomtom',
  GEOCODING_FALLBACK: process.env.GEOCODING_FALLBACK || 'nominatim',

  // --- Digital twin / determinism ---
  // TWIN_SEED seeds the ambient traffic drift so a demo run is reproducible.
  TWIN_SEED: parseInt(process.env.TWIN_SEED || '26137', 10),
  TWIN_BACKGROUND_DRIFT: bool(process.env.TWIN_BACKGROUND_DRIFT, true),
  // ROUTING_OFFLINE=true never calls TomTom/OSRM: geometry comes from the internal road graph (labelled FALLBACK).
  ROUTING_OFFLINE: bool(process.env.ROUTING_OFFLINE, false),

  // Dev convenience: when true and SMTP isn't configured, OTPs are returned
  // in the API response / logged to console instead of emailed, so
  // registration can be tested without real Gmail credentials.
  DEV_EXPOSE_OTP: bool(process.env.DEV_EXPOSE_OTP, process.env.NODE_ENV !== 'production'),
};

export const isProduction = env.NODE_ENV === 'production';
