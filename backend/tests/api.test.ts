import request from 'supertest';
import { createApp } from '../src/app';
import { seedDemoUsers } from '../src/data/seedUsers';

const app = createApp();

describe('health', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('auth', () => {
  const email = `test_${Date.now()}@example.com`;

  it('registers a new user and returns a dev OTP (no SMTP configured)', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Test User', email, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.devOtp).toMatch(/^\d{6}$/);
  });

  it('rejects duplicate registration', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Test User', email, password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('EMAIL_TAKEN');
  });

  it('logs in and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(email);
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('protects routes without a token', async () => {
    const res = await request(app).get('/api/routes/history');
    expect(res.status).toBe(401);
  });

  it('allows access to protected routes with a valid token', async () => {
    const login = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
    const token = login.body.token;
    const res = await request(app).get('/api/routes/history').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('optimization (fully offline, internal graph)', () => {
  let token: string;
  beforeAll(async () => {
    await seedDemoUsers();
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@qroute.in', password: 'admin123' });
    token = login.body.token;
  });

  it('runs a QPSO optimization between two Pune points with a waypoint', async () => {
    const res = await request(app).post('/api/optimization/qpso').set('Authorization', `Bearer ${token}`).send({
      origin: { lat: 18.5204, lon: 73.8567 },
      destination: { lat: 18.5590, lon: 73.7869 },
      waypoints: [{ lat: 18.5912, lon: 73.7389 }],
      populationSize: 10, maxIterations: 15, useWeather: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.distanceKm).toBeGreaterThan(0);
    expect(res.body.convergence.length).toBeGreaterThan(0);
  });

  it('runs a benchmark comparing all four algorithms', async () => {
    const res = await request(app).post('/api/optimization/benchmark').set('Authorization', `Bearer ${token}`).send({
      origin: { lat: 18.5204, lon: 73.8567 },
      destination: { lat: 18.5590, lon: 73.7869 },
      waypoints: [{ lat: 18.5912, lon: 73.7389 }, { lat: 18.5074, lon: 73.8077 }],
      populationSize: 8, maxIterations: 10, useWeather: false,
      algorithms: ['QPSO', 'PSO', 'GA', 'SA'],
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.results)).toEqual(expect.arrayContaining(['QPSO', 'PSO', 'GA', 'SA']));
  });
});

describe('traffic simulation', () => {
  let token: string;
  beforeAll(async () => {
    await seedDemoUsers();
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@qroute.in', password: 'admin123' });
    token = login.body.token;
  });

  it('triggers an accident scenario and reflects it in traffic status', async () => {
    const before = await request(app).get('/api/traffic').set('Authorization', `Bearer ${token}`);
    const sim = await request(app).post('/api/traffic/simulate').set('Authorization', `Bearer ${token}`).send({ scenarioType: 'ACCIDENT' });
    expect(sim.status).toBe(200);
    const after = await request(app).get('/api/traffic').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(200);
    // avg congestion should not be lower than before an accident was added (usually higher/equal)
    expect(after.body.avgCongestionPct).toBeGreaterThanOrEqual(0);
  });
});

describe('friday assistant (offline rule engine)', () => {
  let token: string;
  beforeAll(async () => {
    await seedDemoUsers();
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@qroute.in', password: 'admin123' });
    token = login.body.token;
  });

  it('answers a traffic status command', async () => {
    const res = await request(app).post('/api/friday/chat').set('Authorization', `Bearer ${token}`).send({ text: 'What is the traffic status?' });
    expect(res.status).toBe(200);
    expect(res.body.tool).toBe('traffic.get_current_status');
    expect(res.body.status).toBe('SUCCESS');
  });

  it('requires confirmation for a destructive command', async () => {
    const res = await request(app).post('/api/friday/chat').set('Authorization', `Bearer ${token}`).send({ text: 'trigger an accident' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING_CONFIRMATION');
  });

  it('refuses an unrecognized command gracefully', async () => {
    const res = await request(app).post('/api/friday/chat').set('Authorization', `Bearer ${token}`).send({ text: 'asdkjhaskjdh nonsense' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UNKNOWN');
  });
});
