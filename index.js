// entrypoint for Node.js reimplementation
//
// Usage: node index.js <ip1> [ip2] [ip3] ...
//
// Pass one IP per network interface you want clients to reach the server on.
// Typically: node index.js 172.28.48.1 172.29.99.63
//   172.28.48.1  — WSA (Windows Subsystem for Android) virtual adapter
//   172.29.99.63 — ZeroTier adapter (physical phone)
//
// The master server binds to 0.0.0.0:5055 (all interfaces).
// The game server  binds to 0.0.0.0:5056 (all interfaces).
// When a client creates/joins a room the master server picks the advertised
// game-server address whose IP best matches the client's source address
// (longest-prefix / same subnet wins).

const { MasterServer, RoomManager } = require('./masterServer');
const { GameServer }               = require('./gameServer');
const webConsole                   = require('./webConsole');
const os                           = require('os');

// ── Parse / auto-detect IPs ──────────────────────────────────────────────────
const args = process.argv.slice(2);

// If no IPs supplied, auto-detect all non-loopback IPv4 addresses.
let advertisedIps = args.length > 0
  ? args
  : Object.values(os.networkInterfaces())
      .flat()
      .filter(n => n.family === 'IPv4' && !n.internal)
      .map(n => n.address);

if (advertisedIps.length === 0) advertisedIps = ['0.0.0.0'];

const gameServerAddresses = advertisedIps.map(ip => `${ip}:5056`);

// ── Startup banner ────────────────────────────────────────────────────────────
console.log('Node-based CNR LAN Server (multi-network)');
console.log(`  Master server : 0.0.0.0:5055  (all interfaces)`);
console.log(`  Game server   : 0.0.0.0:5056  (all interfaces)`);
console.log(`  Advertised game-server addresses:`);
for (const addr of gameServerAddresses) {
  console.log(`    ${addr}`);
}
console.log();
console.log('  Set server.cfg on each client:');
for (const ip of advertisedIps) {
  console.log(`    SERVER_IP=${ip}  SERVER_PORT=5055`);
}
console.log();

// ── Start servers ─────────────────────────────────────────────────────────────
const rooms  = new RoomManager();
const master = new MasterServer('0.0.0.0', 5055, gameServerAddresses, rooms);
master.start();

const game = new GameServer('0.0.0.0', 5056, rooms);
game.start();

// ── Web console ───────────────────────────────────────────────────────────────
webConsole.start({
  getStats: () => ({
    masterSessions: master.sessions.size,
    gameSessions:   game.sessions.size,
    rooms:          rooms.rooms.size,
    players:        [...rooms.rooms.values()].reduce((n, r) => n + r.playerCount, 0),
  }),
  getClients: () => ({
    master: [...master.sessions].map(s => ({
      id:            s.id,
      userId:        s.userId,
      ip:            s.socket.remoteAddress,
      connectTime:   s.connectTime,
      authenticated: s.isAuthenticated,
    })),
    game: [...game.sessions].map(s => ({
      id:            s.id,
      userId:        s.userId,
      ip:            s.socket.remoteAddress,
      connectTime:   s.connectTime,
      authenticated: s.isAuthenticated,
      room:          s.currentRoom ? s.currentRoom.name : null,
      actorNr:       s.actorNr,
    })),
  }),
});

module.exports = { master, game, rooms };
