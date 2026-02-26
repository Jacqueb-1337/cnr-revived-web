const net = require('net');
const {peekFrameSize, parseFrame, buildOpResponse, buildPingResponse, buildEvent, ParamKey, EgMsgType, OpCode, photonByte} = require('./protocol');

let sessionIdCounter = 1;

class PlayerSession {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.id = sessionIdCounter++;
    this.isAuthenticated = false;
    this.userId = '';
    this.nickname = '';
    this.connectTime = Date.now();
    this.socket.on('error', err => {
      // suppress per-socket errors in production
    });
  }

  appendAndExtract(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    const frames = [];
    while (true) {
      const sz = peekFrameSize(this.buffer);
      if (sz < 0) break;
      frames.push(this.buffer.slice(0, sz));
      this.buffer = this.buffer.slice(sz);
    }
    return frames;
  }

  send(buf) {
    this.socket.write(buf);
  }
}

class RoomInfo {
  constructor(name) {
    this.name = name;
    this.maxPlayers = 10;          // matches C# default
    this.isOpen = true;
    this.isVisible = true;
    this.map = 'FreeRun3_1';      // C# default map
    this.version = '';
    this.mode = '0';              // C# default mode (TDM)
    this.players = new Set();
    this._actorCounter = 0;
  }
  assignActorNr() { return ++this._actorCounter; }
  get playerCount() { return this.players.size; }
  getGamePropsHashtable() {
    // Keys that the client reads as (byte) MUST be serialized as GpType.Byte.
    // Unboxing int→byte in C# throws InvalidCastException, crashing room setup.
    return {
      255: photonByte(this.maxPlayers),   // (byte)MaxPlayers
      253: this.isOpen,                   // bool IsOpen
      254: this.isVisible,                // bool IsVisible
      252: photonByte(this.playerCount),  // (byte)PlayerCount
      251: false,                         // removedFromList
      map:     this.map,
      version: this.version,
      mode:    this.mode
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }
  getOrCreateRoom(name) {
    if (!this.rooms.has(name)) {
      this.rooms.set(name, new RoomInfo(name));
    }
    return this.rooms.get(name);
  }
  getVisibleRooms() {
    return [...this.rooms.values()].filter(r => r.isVisible && r.isOpen);
  }
  prune() {
    for (const [k,r] of this.rooms) {
      if (r.playerCount === 0) this.rooms.delete(k);
    }
  }
  deleteRoom(name) {
    this.rooms.delete(name);
  }
}

class MasterServer {
  // gameServerAddresses: string[] — each is "ip:port", one per network interface.
  // When redirecting a client we pick the entry whose IP is closest (longest prefix
  // match) to the client's source address, so WSA clients get the WSA IP and
  // ZeroTier clients get the ZeroTier IP.
  constructor(bindAddress, port, gameServerAddresses, rooms) {
    this.bindAddress = bindAddress;
    this.port = port;
    // Accept both a single string and an array for backwards-compat
    this.gameServerAddresses = Array.isArray(gameServerAddresses)
      ? gameServerAddresses
      : [gameServerAddresses];
    this.rooms = rooms;
    this.sessions = new Set();
  }

  // Pick the advertised game-server address that best matches the client's IP.
  // "Best match" = most leading octets in common (longest prefix).
  pickGameServer(clientRemoteAddr) {
    if (this.gameServerAddresses.length === 1) return this.gameServerAddresses[0];
    // strip IPv6-mapped prefix (::ffff:) if present
    const clientIp = (clientRemoteAddr || '').replace(/^::ffff:/, '');
    const clientOctets = clientIp.split('.').map(Number);
    let best = this.gameServerAddresses[0];
    let bestScore = -1;
    for (const addr of this.gameServerAddresses) {
      const ip = addr.split(':')[0];  // addr is "ip:port"
      const octets = ip.split('.').map(Number);
      let score = 0;
      for (let i = 0; i < Math.min(octets.length, clientOctets.length); i++) {
        if (octets[i] === clientOctets[i]) score++;
        else break;
      }
      if (score > bestScore) { bestScore = score; best = addr; }
    }
    return best;
  }

  start() {
    this.server = net.createServer(sock => this.handleConnect(sock));
    this.server.listen(this.port, this.bindAddress, () => {
      console.log(`[Master] Listening on ${this.bindAddress}:${this.port}`);
      console.log(`[Master] Advertised game-server addresses: ${this.gameServerAddresses.join(', ')}`);
    });
    // periodic broadcast
    this.interval = setInterval(() => this.broadcastRoomList(false), 5000);
  }
  stop() {
    clearInterval(this.interval);
    this.server.close();
  }

  handleConnect(sock) {
    const session = new PlayerSession(sock);
    this.sessions.add(session);
    console.log(`[Master] Client ${session.id} connected from ${sock.remoteAddress}`);
    sock.on('data', data => this.handleData(session, data));
    sock.on('close', () => {
      console.log(`[Master] Client ${session.id} (${session.userId || 'anon'}) disconnected`);
      this.sessions.delete(session);
    });
  }

  handleData(session, data) {
    for (const frame of session.appendAndExtract(data)) {
      const msg = parseFrame(frame);
      if (!msg) continue;
      if (msg.IsInit) {
        session.send(Buffer.from([0xF3,0,0,0,9,0,0,0xF3,0x01]));
        continue;
      }
      if (msg.IsPing) {
        session.send(buildPingResponse(msg.PingFrame));
        continue;
      }
      if (msg.OpRequest) {
        this.processOp(session, msg.OpRequest);
      }
    }
  }

  processOp(session, req) {
    switch (req.OpCode) {
      case OpCode.Authenticate:
        this.handleAuth(session, req);
        break;
      case OpCode.JoinLobby:
        this.handleJoinLobby(session);
        break;
      case OpCode.CreateGame:
        this.handleCreateGame(session, req);
        break;
      case OpCode.JoinGame:
        this.handleJoinGame(session, req);
        break;
      case OpCode.JoinRandom:
        this.handleJoinRandom(session);
        break;
      default:
        console.log(`[Master] unhandled op 0x${req.OpCode.toString(16)}`);
        break;
    }
  }

  handleAuth(session, req) {
    if (req.Parameters && req.Parameters[ParamKey.userId]) {
      session.userId = String(req.Parameters[ParamKey.userId]);
    }
    console.log(`[Master] Session ${session.id} authenticated as '${session.userId}'`);
    session.isAuthenticated = true;
    session.send(buildOpResponse(OpCode.Authenticate, 0, null));
  }

  handleJoinLobby(session) {
    session.send(buildOpResponse(OpCode.JoinLobby, 0, null));
    this.sendRoomList(session, true);
  }

  handleCreateGame(session, req) {
    const roomName = (req.Parameters && req.Parameters[ParamKey.RoomName]) || Math.random().toString(36).slice(2,10);
    const room = this.rooms.getOrCreateRoom(roomName);
    console.log(`[Master] Client ${session.id} creating room '${roomName}'`);
    const gameAddr = this.pickGameServer(session.socket.remoteAddress);
    const p = { [ParamKey.GameServer]: gameAddr };
    session.send(buildOpResponse(OpCode.CreateGame, 0, p));
  }

  handleJoinGame(session, req) {
    const roomName = req.Parameters && req.Parameters[ParamKey.RoomName];
    if (!roomName) {
      session.send(buildOpResponse(OpCode.JoinGame, 32765, null, 'Room name missing'));
      return;
    }
    console.log(`[Master] Client ${session.id} joining room '${roomName}'`);
    const gameAddr = this.pickGameServer(session.socket.remoteAddress);
    const p = { [ParamKey.GameServer]: gameAddr };
    session.send(buildOpResponse(OpCode.JoinGame, 0, p));
  }

  handleJoinRandom(session) {
    const visible = this.rooms.getVisibleRooms();
    if (visible.length === 0) {
      session.send(buildOpResponse(OpCode.JoinRandom, 32760, null, 'NoRandomMatchFound'));
      return;
    }
    const room = visible[0];
    const gameAddr = this.pickGameServer(session.socket.remoteAddress);
    const p = { [ParamKey.RoomName]: room.name, [ParamKey.GameServer]: gameAddr };
    session.send(buildOpResponse(OpCode.JoinRandom, 0, p));
  }

  sendRoomList(session, full) {
    const eventCode = full ? 230 : 229; // GameList / GameListUpd
    const roomsHt = {};
    for (const r of this.rooms.getVisibleRooms()) {
      roomsHt[r.name] = {
        255: photonByte(r.maxPlayers),
        253: r.isOpen,
        254: r.isVisible,
        252: photonByte(r.playerCount),
        251: false,
        map:     r.map,
        version: r.version,
        mode:    r.mode
      };
    }
    const p = { 222: roomsHt };
    session.send(buildEvent(eventCode, p));
  }

  broadcastRoomList(full) {
    for (const s of this.sessions) {
      if (s.isAuthenticated) this.sendRoomList(s, full);
    }
  }
}

module.exports = { MasterServer, RoomManager };
