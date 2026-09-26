import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['citizen', 'admin'], default: 'citizen' },
  emailVerified: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });

const OtpSchema = new Schema({
  email: { type: String, required: true, index: true },
  hashedCode: { type: String, required: true },
  purpose: { type: String, enum: ['verify_email', 'reset_password'], required: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  expiresAt: { type: Date, required: true },
  consumed: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });

const GeoPoint = { lat: Number, lon: Number, label: String };

const SavedRouteSchema = new Schema({
  userId: { type: String, default: null },
  name: String,
  origin: GeoPoint,
  destination: GeoPoint,
  waypoints: [GeoPoint],
  vehicle: Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });

const OptimizationResultSchema = new Schema({
  userId: { type: String, default: null },
  algorithm: String,
  origin: GeoPoint,
  destination: GeoPoint,
  waypointOrder: [Number],
  bestFitness: Number,
  distanceKm: Number,
  durationMinutes: Number,
  fuelCostInr: Number,
  co2Kg: Number,
  convergence: [Number],
  runtimeSeconds: Number,
  iterations: Number,
  geometry: [GeoPoint],
  routes: [Schema.Types.Mixed],
  explanation: [String],
}, { timestamps: { createdAt: true, updatedAt: false } });

const TrafficIncidentSchema = new Schema({
  type: String,
  lat: Number,
  lon: Number,
  severity: { type: String, enum: ['LOW', 'MODERATE', 'HIGH', 'SEVERE'] },
  description: String,
  provider: String,
  active: { type: Boolean, default: true },
  edgeId: { type: String, default: null },
  closedEdge: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });

const IntelligenceEventSchema = new Schema({
  category: { type: String, enum: ['WEATHER', 'ROAD_CONDITION', 'CLOSURE', 'MAINTENANCE', 'CROWD', 'OBSTACLE', 'LANDSLIDE'], required: true },
  type: { type: String, required: true }, // e.g. 'Heavy Rain', 'Pothole', 'Full Closure'
  location: GeoPoint,
  roadSegment: String,
  severity: { type: String, enum: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL', 'SEVERE'], required: true },
  status: { type: String, enum: ['DETECTED', 'VERIFYING', 'CONFIRMED', 'CLEARING', 'CLEARED'], default: 'DETECTED' },
  source: { type: String, default: 'SYSTEM' },
  confidence: { type: Number, min: 0, max: 100, default: 100 },
  isSimulated: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null }
}, { timestamps: true });

const AiConversationSchema = new Schema({
  userId: { type: String, default: null },
  sessionId: String,
  role: { type: String, enum: ['user', 'assistant'] },
  text: String,
  intent: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

const AuditLogSchema = new Schema({
  userId: { type: String, default: null },
  action: String,
  details: Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });

const NotificationSchema = new Schema({
  userId: { type: String, default: null },
  title: String,
  message: String,
  read: { type: Boolean, default: false },
  payload: { type: Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

const VehicleSchema = new Schema({
  type: String,
  maxSpeedKmph: Number,
  fuelEfficiencyKmPerL: Number,
  fuelType: String,
  capacityKg: Number,
  priority: String,
});

export const UserModel = mongoose.model('User', UserSchema);
export const OtpModel = mongoose.model('Otp', OtpSchema);
export const SavedRouteModel = mongoose.model('SavedRoute', SavedRouteSchema);
export const OptimizationResultModel = mongoose.model('OptimizationResult', OptimizationResultSchema);
export const TrafficIncidentModel = mongoose.model('TrafficIncident', TrafficIncidentSchema);
export const IntelligenceEventModel = mongoose.model('IntelligenceEvent', IntelligenceEventSchema);
export const AiConversationModel = mongoose.model('AIConversation', AiConversationSchema);
export const AuditLogModel = mongoose.model('AuditLog', AuditLogSchema);
export const NotificationModel = mongoose.model('Notification', NotificationSchema);
export const VehicleModel = mongoose.model('Vehicle', VehicleSchema);
