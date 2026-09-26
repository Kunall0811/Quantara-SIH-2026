export interface UserDoc {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'citizen' | 'admin';
  emailVerified: boolean;
  createdAt: Date;
}

export interface OtpDoc {
  id: string;
  email: string;
  hashedCode: string;
  purpose: 'verify_email' | 'reset_password';
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumed: boolean;
  createdAt: Date;
}

export interface VehicleProfile {
  id: string;
  type: 'car' | 'truck' | 'ambulance' | 'delivery' | 'bus' | 'two_wheeler';
  maxSpeedKmph: number;
  fuelEfficiencyKmPerL: number; // for EVs, treat as km per kWh
  fuelType: 'petrol' | 'diesel' | 'electric' | 'cng';
  capacityKg: number;
  priority: 'normal' | 'high' | 'emergency';
}

export interface SavedRouteDoc {
  id: string;
  userId: string | null;
  name: string;
  origin: { lat: number; lon: number; label?: string };
  destination: { lat: number; lon: number; label?: string };
  waypoints: { lat: number; lon: number; label?: string }[];
  vehicle: VehicleProfile;
  createdAt: Date;
}

export interface OptimizationResultDoc {
  id: string;
  userId: string | null;
  algorithm: string;
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  waypointOrder: number[];
  bestFitness: number;
  distanceKm: number;
  durationMinutes: number;
  fuelCostInr: number;
  co2Kg: number;
  convergence: number[];
  runtimeSeconds: number;
  iterations: number;
  geometry: { lat: number; lon: number }[];
  routes?: { vehicleId: string; geometry: { lat: number; lon: number }[]; distanceKm: number; durationMinutes: number; load: number; arrivalTimes?: number[] }[];
  explanation: string[];
  createdAt: Date;
}

export interface TrafficIncidentDoc {
  id: string;
  type: string;
  lat: number;
  lon: number;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  description: string;
  provider: string;
  active: boolean;
  createdAt: Date;
  /** Nearest graph edge this incident affected, so resolving/closing it can
   *  precisely restore that edge's traffic/closed state instead of leaving
   *  the road permanently degraded. */
  edgeId?: string | null;
  /** For ROAD_CLOSURE incidents: was the edge actually closed (vs just slowed)? */
  closedEdge?: boolean;
}

export interface AiConversationDoc {
  id: string;
  userId: string | null;
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  intent?: string;
  createdAt: Date;
}

export interface AuditLogDoc {
  id: string;
  userId: string | null;
  action: string;
  details: Record<string, any>;
  createdAt: Date;
}

export interface NotificationDoc {
  id: string;
  userId: string | null;
  title: string;
  message: string;
  read: boolean;
  createdAt: Date;
  payload?: any; // Optional rich data (e.g. mission payload with lat/lon)
}

export interface DataStore {
  backend: 'mongodb' | 'memory';

  createUser(u: Omit<UserDoc, 'id' | 'createdAt'>): Promise<UserDoc>;
  findUserByEmail(email: string): Promise<UserDoc | null>;
  findUserById(id: string): Promise<UserDoc | null>;
  listUsers(): Promise<UserDoc[]>;
  setEmailVerified(userId: string): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;

  createOtp(o: Omit<OtpDoc, 'id' | 'createdAt' | 'attempts' | 'consumed'>): Promise<OtpDoc>;
  findLatestOtp(email: string, purpose: OtpDoc['purpose']): Promise<OtpDoc | null>;
  incrementOtpAttempts(id: string): Promise<void>;
  consumeOtp(id: string): Promise<void>;

  saveRoute(r: Omit<SavedRouteDoc, 'id' | 'createdAt'>): Promise<SavedRouteDoc>;
  listSavedRoutes(userId: string | null): Promise<SavedRouteDoc[]>;

  saveOptimizationResult(r: Omit<OptimizationResultDoc, 'id' | 'createdAt'>): Promise<OptimizationResultDoc>;
  getOptimizationResult(id: string): Promise<OptimizationResultDoc | null>;
  listOptimizationResults(limit: number): Promise<OptimizationResultDoc[]>;

  createIncident(i: Omit<TrafficIncidentDoc, 'id' | 'createdAt' | 'active'>): Promise<TrafficIncidentDoc>;
  listActiveIncidents(): Promise<TrafficIncidentDoc[]>;
  getIncident(id: string): Promise<TrafficIncidentDoc | null>;
  resolveIncident(id: string): Promise<void>;

  logConversation(c: Omit<AiConversationDoc, 'id' | 'createdAt'>): Promise<void>;
  listConversation(sessionId: string, limit: number): Promise<AiConversationDoc[]>;

  writeAudit(a: Omit<AuditLogDoc, 'id' | 'createdAt'>): Promise<void>;
  listAudit(limit: number): Promise<AuditLogDoc[]>;

  createNotification(n: Omit<NotificationDoc, 'id' | 'createdAt' | 'read'>): Promise<void>;
  listNotifications(userId: string | null): Promise<NotificationDoc[]>;
  markNotificationRead(id: string): Promise<void>;
  dismissAllNotifications(userId: string | null): Promise<void>;
}
