import mongoose from 'mongoose';
import { env } from '../config/env';
import { DataStore } from './types';
import { MemoryStore } from './memoryStore';
import { MongoStore } from './mongoStore';

let store: DataStore = new MemoryStore();
let connected = false;
let connectionAttempted = false;

export function getStore(): DataStore {
  return store;
}

export function isMongoConnected(): boolean {
  return connected;
}

/**
 * Attempts to connect to MongoDB (Atlas or self-hosted) if MONGODB_URI is
 * set. On any failure - missing URI, network error, auth error, timeout -
 * the app transparently keeps using the in-memory store instead of
 * crashing, and logs a clear one-line explanation. This is what lets
 * `npm run dev` work immediately in VS Code with zero external setup.
 */
export async function connectDatabase(): Promise<void> {
  connectionAttempted = true;
  if (!env.MONGODB_URI) {
    console.warn('[db] MONGODB_URI not set — using the in-memory data store (data will not persist across restarts).');
    store = new MemoryStore();
    connected = false;
    return;
  }
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
    store = new MongoStore();
    connected = true;
    console.log('[db] Connected to MongoDB.');
    mongoose.connection.on('disconnected', () => {
      console.warn('[db] MongoDB disconnected — falling back to the in-memory store.');
      connected = false;
      store = new MemoryStore();
    });
  } catch (err: any) {
    console.warn(`[db] MongoDB connection failed (${err.message}) — using the in-memory data store instead.`);
    store = new MemoryStore();
    connected = false;
  }
}

export function dbStatus() {
  return {
    backend: store.backend,
    connected,
    configured: !!env.MONGODB_URI,
    note: connected
      ? 'Connected to MongoDB.'
      : connectionAttempted
        ? 'Using in-memory store (MongoDB not connected). Data will not persist across restarts.'
        : 'Not yet initialized.',
  };
}
