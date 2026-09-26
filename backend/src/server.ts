import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase } from './store';
import { initSocket } from './socket';
import { seedDemoUsers } from './data/seedUsers';
import { stepBackgroundDrift } from './services/trafficManager';
import { getIo } from './socket';
import { tickFleet } from './services/fleetTracker';

async function main() {
  await connectDatabase();
  await seedDemoUsers();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.PORT, () => {
    console.log(`\n🚦 Q-ROUTE INDIA backend running on http://localhost:${env.PORT}`);
    console.log(`   Health check: http://localhost:${env.PORT}/api/health`);
    console.log(`   Frontend CORS origin: ${env.FRONTEND_URL}\n`);
  });

  // background traffic drift + broadcast, so connected dashboards see
  // gentle live-feeling changes without any manual trigger
  setInterval(() => {
    const changed = stepBackgroundDrift();
    if (changed.length) getIo()?.emit('traffic_update', { changedEdges: changed.length });
  }, 10_000);

  // Live fleet tracker: advances route-matched vehicles and broadcasts GPS-like
  // updates. Real devices can replace this stream through POST /api/fleet/:id/gps.
  setInterval(() => tickFleet(2), 2_000);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
