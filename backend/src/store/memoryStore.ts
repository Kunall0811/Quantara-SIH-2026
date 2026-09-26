import { randomUUID } from 'crypto';
import {
  DataStore, UserDoc, OtpDoc, SavedRouteDoc, OptimizationResultDoc,
  TrafficIncidentDoc, AiConversationDoc, AuditLogDoc, NotificationDoc,
} from './types';

/**
 * Zero-setup in-memory data store. Used automatically whenever MONGODB_URI
 * is unset or unreachable, so the project runs immediately in VS Code
 * without requiring a MongoDB Atlas cluster first. Data does not persist
 * across restarts - connect a real MongoDB URI in .env for that.
 */
export class MemoryStore implements DataStore {
  backend: 'memory' = 'memory';

  private users = new Map<string, UserDoc>();
  private otps = new Map<string, OtpDoc>();
  private savedRoutes = new Map<string, SavedRouteDoc>();
  private optimizationResults = new Map<string, OptimizationResultDoc>();
  private incidents = new Map<string, TrafficIncidentDoc>();
  private conversations: AiConversationDoc[] = [];
  private audit: AuditLogDoc[] = [];
  private notifications: NotificationDoc[] = [];

  async createUser(u: Omit<UserDoc, 'id' | 'createdAt'>): Promise<UserDoc> {
    const doc: UserDoc = { ...u, id: randomUUID(), createdAt: new Date() };
    this.users.set(doc.id, doc);
    return doc;
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
  }
  async findUserById(id: string) {
    return this.users.get(id) || null;
  }
  async listUsers() {
    return [...this.users.values()];
  }
  async setEmailVerified(userId: string) {
    const u = this.users.get(userId);
    if (u) u.emailVerified = true;
  }
  async updatePassword(userId: string, passwordHash: string) {
    const u = this.users.get(userId);
    if (u) u.passwordHash = passwordHash;
  }

  async createOtp(o: Omit<OtpDoc, 'id' | 'createdAt' | 'attempts' | 'consumed'>) {
    const doc: OtpDoc = { ...o, id: randomUUID(), attempts: 0, consumed: false, createdAt: new Date() };
    this.otps.set(doc.id, doc);
    return doc;
  }
  async findLatestOtp(email: string, purpose: OtpDoc['purpose']) {
    const matches = [...this.otps.values()]
      .filter((o) => o.email.toLowerCase() === email.toLowerCase() && o.purpose === purpose && !o.consumed)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] || null;
  }
  async incrementOtpAttempts(id: string) {
    const o = this.otps.get(id);
    if (o) o.attempts += 1;
  }
  async consumeOtp(id: string) {
    const o = this.otps.get(id);
    if (o) o.consumed = true;
  }

  async saveRoute(r: Omit<SavedRouteDoc, 'id' | 'createdAt'>) {
    const doc: SavedRouteDoc = { ...r, id: randomUUID(), createdAt: new Date() };
    this.savedRoutes.set(doc.id, doc);
    return doc;
  }
  async listSavedRoutes(userId: string | null) {
    return [...this.savedRoutes.values()].filter((r) => !userId || r.userId === userId);
  }

  async saveOptimizationResult(r: Omit<OptimizationResultDoc, 'id' | 'createdAt'>) {
    const doc: OptimizationResultDoc = { ...r, id: randomUUID(), createdAt: new Date() };
    this.optimizationResults.set(doc.id, doc);
    return doc;
  }
  async getOptimizationResult(id: string) {
    return this.optimizationResults.get(id) || null;
  }
  async listOptimizationResults(limit: number) {
    return [...this.optimizationResults.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async createIncident(i: Omit<TrafficIncidentDoc, 'id' | 'createdAt' | 'active'>) {
    const doc: TrafficIncidentDoc = { ...i, id: randomUUID(), active: true, createdAt: new Date() };
    this.incidents.set(doc.id, doc);
    return doc;
  }
  async listActiveIncidents() {
    return [...this.incidents.values()].filter((i) => i.active);
  }
  async getIncident(id: string) {
    return this.incidents.get(id) || null;
  }
  async resolveIncident(id: string) {
    const i = this.incidents.get(id);
    if (i) i.active = false;
  }

  async logConversation(c: Omit<AiConversationDoc, 'id' | 'createdAt'>) {
    this.conversations.push({ ...c, id: randomUUID(), createdAt: new Date() });
  }
  async listConversation(sessionId: string, limit: number) {
    return this.conversations.filter((c) => c.sessionId === sessionId).slice(-limit);
  }

  async writeAudit(a: Omit<AuditLogDoc, 'id' | 'createdAt'>) {
    this.audit.push({ ...a, id: randomUUID(), createdAt: new Date() });
  }
  async listAudit(limit: number) {
    return this.audit.slice(-limit).reverse();
  }

  async createNotification(n: Omit<NotificationDoc, 'id' | 'createdAt' | 'read'>) {
    this.notifications.push({ ...n, id: randomUUID(), read: false, createdAt: new Date() });
  }
  async listNotifications(userId: string | null) {
    return this.notifications.filter((n) => !userId || n.userId === userId || n.userId === null);
  }
  async markNotificationRead(id: string) {
    const n = this.notifications.find((x) => x.id === id);
    if (n) n.read = true;
  }
  async dismissAllNotifications(userId: string | null) {
    this.notifications.forEach((n) => {
      if (!userId || n.userId === userId || n.userId === null) n.read = true;
    });
  }
}
