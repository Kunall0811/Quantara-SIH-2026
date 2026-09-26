import {
  DataStore, UserDoc, OtpDoc, SavedRouteDoc, OptimizationResultDoc,
  TrafficIncidentDoc, AiConversationDoc, AuditLogDoc, NotificationDoc,
} from './types';
import {
  UserModel, OtpModel, SavedRouteModel, OptimizationResultModel,
  TrafficIncidentModel, AiConversationModel, AuditLogModel, NotificationModel,
} from '../models/schemas';

function toUser(d: any): UserDoc {
  return { id: d._id.toString(), name: d.name, email: d.email, passwordHash: d.passwordHash,
    role: d.role, emailVerified: d.emailVerified, createdAt: d.createdAt };
}
function toOtp(d: any): OtpDoc {
  return { id: d._id.toString(), email: d.email, hashedCode: d.hashedCode, purpose: d.purpose,
    attempts: d.attempts, maxAttempts: d.maxAttempts, expiresAt: d.expiresAt, consumed: d.consumed,
    createdAt: d.createdAt };
}
function toSavedRoute(d: any): SavedRouteDoc {
  return { id: d._id.toString(), userId: d.userId, name: d.name, origin: d.origin,
    destination: d.destination, waypoints: d.waypoints, vehicle: d.vehicle, createdAt: d.createdAt };
}
function toOptResult(d: any): OptimizationResultDoc {
  return { id: d._id.toString(), userId: d.userId, algorithm: d.algorithm, origin: d.origin,
    destination: d.destination, waypointOrder: d.waypointOrder, bestFitness: d.bestFitness,
    distanceKm: d.distanceKm, durationMinutes: d.durationMinutes, fuelCostInr: d.fuelCostInr,
    co2Kg: d.co2Kg, convergence: d.convergence, runtimeSeconds: d.runtimeSeconds,
    iterations: d.iterations, geometry: d.geometry, routes: d.routes, explanation: d.explanation, createdAt: d.createdAt };
}
function toIncident(d: any): TrafficIncidentDoc {
  return { id: d._id.toString(), type: d.type, lat: d.lat, lon: d.lon, severity: d.severity,
    description: d.description, provider: d.provider, active: d.active, createdAt: d.createdAt,
    edgeId: d.edgeId ?? null, closedEdge: !!d.closedEdge };
}

export class MongoStore implements DataStore {
  backend: 'mongodb' = 'mongodb';

  async createUser(u: Omit<UserDoc, 'id' | 'createdAt'>) {
    const d = await UserModel.create(u);
    return toUser(d);
  }
  async findUserByEmail(email: string) {
    const d = await UserModel.findOne({ email: email.toLowerCase() });
    return d ? toUser(d) : null;
  }
  async findUserById(id: string) {
    const d = await UserModel.findById(id).catch(() => null);
    return d ? toUser(d) : null;
  }
  async listUsers() {
    const docs = await UserModel.find();
    return docs.map(toUser);
  }
  async setEmailVerified(userId: string) {
    await UserModel.findByIdAndUpdate(userId, { emailVerified: true });
  }
  async updatePassword(userId: string, passwordHash: string) {
    await UserModel.findByIdAndUpdate(userId, { passwordHash });
  }

  async createOtp(o: Omit<OtpDoc, 'id' | 'createdAt' | 'attempts' | 'consumed'>) {
    const d = await OtpModel.create({ ...o, attempts: 0, consumed: false });
    return toOtp(d);
  }
  async findLatestOtp(email: string, purpose: OtpDoc['purpose']) {
    const d = await OtpModel.findOne({ email: email.toLowerCase(), purpose, consumed: false }).sort({ createdAt: -1 });
    return d ? toOtp(d) : null;
  }
  async incrementOtpAttempts(id: string) {
    await OtpModel.findByIdAndUpdate(id, { $inc: { attempts: 1 } });
  }
  async consumeOtp(id: string) {
    await OtpModel.findByIdAndUpdate(id, { consumed: true });
  }

  async saveRoute(r: Omit<SavedRouteDoc, 'id' | 'createdAt'>) {
    const d = await SavedRouteModel.create(r);
    return toSavedRoute(d);
  }
  async listSavedRoutes(userId: string | null) {
    const docs = await SavedRouteModel.find(userId ? { userId } : {});
    return docs.map(toSavedRoute);
  }

  async saveOptimizationResult(r: Omit<OptimizationResultDoc, 'id' | 'createdAt'>) {
    const d = await OptimizationResultModel.create(r);
    return toOptResult(d);
  }
  async getOptimizationResult(id: string) {
    const d = await OptimizationResultModel.findById(id).catch(() => null);
    return d ? toOptResult(d) : null;
  }
  async listOptimizationResults(limit: number) {
    const docs = await OptimizationResultModel.find().sort({ createdAt: -1 }).limit(limit);
    return docs.map(toOptResult);
  }

  async createIncident(i: Omit<TrafficIncidentDoc, 'id' | 'createdAt' | 'active'>) {
    const d = await TrafficIncidentModel.create({ ...i, active: true });
    return toIncident(d);
  }
  async listActiveIncidents() {
    const docs = await TrafficIncidentModel.find({ active: true });
    return docs.map(toIncident);
  }
  async getIncident(id: string) {
    const d = await TrafficIncidentModel.findById(id);
    return d ? toIncident(d) : null;
  }
  async resolveIncident(id: string) {
    await TrafficIncidentModel.findByIdAndUpdate(id, { active: false });
  }

  async logConversation(c: Omit<AiConversationDoc, 'id' | 'createdAt'>) {
    await AiConversationModel.create(c);
  }
  async listConversation(sessionId: string, limit: number) {
    const docs = await AiConversationModel.find({ sessionId }).sort({ createdAt: 1 }).limit(limit);
    return docs.map((d: any) => ({ id: d._id.toString(), userId: d.userId, sessionId: d.sessionId,
      role: d.role, text: d.text, intent: d.intent, createdAt: d.createdAt }));
  }

  async writeAudit(a: Omit<AuditLogDoc, 'id' | 'createdAt'>) {
    await AuditLogModel.create(a);
  }
  async listAudit(limit: number) {
    const docs = await AuditLogModel.find().sort({ createdAt: -1 }).limit(limit);
    return docs.map((d: any) => ({ id: d._id.toString(), userId: d.userId, action: d.action,
      details: d.details, createdAt: d.createdAt }));
  }

  async createNotification(n: Omit<NotificationDoc, 'id' | 'createdAt' | 'read'>) {
    await NotificationModel.create({ ...n, read: false });
  }
  async listNotifications(userId: string | null) {
    const query = userId ? { $or: [{ userId }, { userId: null }] } : {};
    const docs = await NotificationModel.find(query).sort({ createdAt: -1 });
    return docs.map((d: any) => ({
      id: d._id.toString(),
      userId: d.userId,
      title: d.title,
      message: d.message,
      read: !!d.read,
      createdAt: d.createdAt,
      payload: d.payload || null,
    }));
  }
  async markNotificationRead(id: string) {
    await NotificationModel.findByIdAndUpdate(id, { read: true });
  }
  async dismissAllNotifications(userId: string | null) {
    const query = userId ? { $or: [{ userId }, { userId: null }] } : {};
    await NotificationModel.updateMany(query, { read: true });
  }
}
