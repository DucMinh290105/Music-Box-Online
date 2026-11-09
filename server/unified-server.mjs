import http from 'http';
import next from 'next';
import { attachRealtimeServer, getOrCreateRoom, rooms } from './realtime-server.mjs';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const defaultRoom = getOrCreateRoom('1234');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'music-box-unified',
        activeRooms: rooms.size,
        members: defaultRoom.members.size,
      })
    );
    return;
  }
  handle(req, res);
});

attachRealtimeServer(server);

server.listen(port, hostname, () => {
  console.log(`========================================================`);
  console.log(`  Music Box Online - Unified Web + Realtime + Voice Server`);
  console.log(`  Ready on: http://${hostname}:${port}`);
  console.log(`========================================================`);
});
