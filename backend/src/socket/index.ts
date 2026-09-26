import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { env } from '../config/env';

let io: Server | null = null;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: env.FRONTEND_URL, credentials: true } });

  io.on('connection', (socket: Socket) => {
    socket.on('join', (room: string) => socket.join(room));
    socket.on('disconnect', () => {});
  });

  return io;
}

export function getIo(): Server | null {
  return io;
}

export function broadcastTrafficUpdate(payload: any) {
  io?.emit('traffic_update', payload);
}
