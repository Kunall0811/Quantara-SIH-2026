import { getStore } from '../store';
import { hashPassword } from '../utils/auth';

/**
 * Seeds two demo accounts (citizen + admin) so the app is immediately
 * usable after `npm run dev` without a manual sign-up step. Safe to call
 * every boot - it checks for existing users first.
 */
export async function seedDemoUsers() {
  const store = getStore();
  const citizen = await store.findUserByEmail('citizen@qroute.in');
  if (!citizen) {
    await store.createUser({
      name: 'Demo Citizen', email: 'citizen@qroute.in',
      passwordHash: await hashPassword('citizen123'), role: 'citizen', emailVerified: true,
    });
  }

  const admin = await store.findUserByEmail('admin@qroute.in');
  if (!admin) {
    await store.createUser({
      name: 'Admin', email: 'admin@qroute.in',
      passwordHash: await hashPassword('admin123'), role: 'admin', emailVerified: true,
    });
  }
  console.log('[seed] Demo accounts created: citizen@qroute.in / citizen123, admin@qroute.in / admin123');
}
