// Photon-like protocol constants and basic helpers
// This module will be expanded as we port more of the C# implementation

const GpType = {
  Null: 42,       // '*'
  Boolean: 111,   // 'o'
  Byte: 98,       // 'b'
  Short: 107,     // 'k'
  Integer: 105,   // 'i'
  Long: 108,      // 'l'
  Float: 102,     // 'f'
  Double: 100,    // 'd'
  String: 115,    // 's'
  StringArray: 97, // 'a'
  ByteArray: 120, // 'x'
  IntArray: 121,  // 'y'
  Hashtable: 104, // 'h'
  Dictionary: 68, // 'D'
  ObjectArray: 122, // 'z'
  EventData: 101, // 'e'
  OpRequest: 113, // 'q'
  OpResponse: 112,// 'p'
  Array: 121
};

const OpCode = {
  Join: 0xFF,
  Leave: 0xFE,
  RaiseEvent: 0xFD,
  SetProperties: 0xFC,
  GetProperties: 0xFB,
  ChangeGroups: 0xF8,
  FindFriends: 0xE0,
  CreateGame: 0xE3,
  JoinGame: 0xE2,
  JoinRandom: 0xE1,
  JoinLobby: 0xE5,
  LeaveLobby: 0xE4,
  Authenticate: 0xE6,
  GetRegions: 0xDC,
  Ping: 0x00
};

const EgMsgType = {
  OperationResponse: 3,
  EventData: 4,
};

const TcpMagic = 0xF3;
const HeaderLen = 9;

const ParamKey = {
  RoomName: 0xFF,
  ActorNr: 0xFE,
  TargetActorNr: 0xFD,
  ActorList: 0xFC,
  PlayerProps: 0xF9,
  GameProps: 0xF8,
  GameList: 0xF6,
  RoomOptionFlags: 0xF2,
  CleanupCache: 0xF1,
  MaxPlayers: 0xEF,
  IsOpen: 0xED,
  IsVisible: 0xEC,
  ExpectedUsers: 0xEB,
  GameServer: 0xE6,
  AppId: 0xE0,
  AppVersion: 0xDC,
  userId: 0xE1,
  SecretOrToken: 0xDD,
  LobbyName: 0xD5,
  LobbyType: 0xD4,
  ClientKey: 0xD1,
  EventCode: 0xF4,
  Data: 0xF5,
  Code: 0xF4,
  Position: 0xF7,
  ServerTime: 0xE4,
  RoomCount: 0xE3,
  PeerCount: 0xE2,
  MasterPeerCount: 0xE1
};

// helpers for big-endian integers
function readInt16BE(buf, offset) {
  return buf.readInt16BE(offset);
}
function readInt32BE(buf, offset) {
  return buf.readInt32BE(offset);
}
function writeInt16BE(buf, value, offset) {
  buf.writeInt16BE(value, offset);
}
function writeInt32BE(buf, value, offset) {
  buf.writeInt32BE(value, offset);
}

// frame wrapper
function wrapTcpFrame(msgType, payload) {
  const total = HeaderLen + payload.length;
  const frame = Buffer.alloc(total);
  frame[0] = TcpMagic;
  frame.writeUInt32BE(total, 1);
  frame[5] = 0x00; // channel
  frame[6] = 0x00; // flags
  frame[7] = TcpMagic; // inner magic
  frame[8] = msgType;
  payload.copy(frame, HeaderLen);
  return frame;
}

function writeStringWithType(stream, str) {
  const strBuf = Buffer.from(str, 'utf8');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeInt16BE(strBuf.length,0);
  stream.push(Buffer.from([GpType.String]));
  stream.push(lenBuf);
  stream.push(strBuf);
}

// build a complete TCP frame for an operation response
function buildOpResponse(opCode, returnCode, parameters, debugMsg) {
  const parts = [];
  parts.push(Buffer.from([opCode]));
  const rcBuf = Buffer.alloc(2);
  rcBuf.writeInt16BE(returnCode,0);
  parts.push(rcBuf);
  if (!debugMsg) {
    parts.push(Buffer.from([GpType.Null]));
  } else {
    writeStringWithType(parts, debugMsg);
  }
  serializeParamTable(parts, parameters);
  const payload = Buffer.concat(parts);
  const frame = wrapTcpFrame(EgMsgType.OperationResponse, payload);
  return frame;
}

// build a ping response: {0xF0, serverTime[4 BE], clientSentTime[4 BE]} = 9 bytes
function buildPingResponse(clientFrame) {
  const resp = Buffer.alloc(9);
  resp[0] = 0xF0;
  const serverMs = (Date.now()) & 0x7FFFFFFF;
  resp.writeInt32BE(serverMs, 1);
  // echo back client's sent-time (bytes 1-4 of the 5-byte ping frame)
  if (clientFrame && clientFrame.length >= 5) {
    clientFrame.copy(resp, 5, 1, 5);
  }
  return resp;
}

// build an event frame
function buildEvent(eventCode, parameters) {
  const parts = [];
  parts.push(Buffer.from([eventCode]));
  serializeParamTable(parts, parameters);
  const payload = Buffer.concat(parts);
  const frame = wrapTcpFrame(EgMsgType.EventData, payload);
  return frame;
}

// frame peeking logic (copied from index.js)
function peekFrameSize(buf) {
  if (buf.length < 1) return -1;
  const b = buf[0];
  if (b === 0xF0) {
    return buf.length >= 5 ? 5 : -1;
  }
  if (b !== 0xFB && b !== 0xF3 && b !== 0xF4) return -1;
  if (buf.length < 5) return -1;
  const len = readInt32BE(buf, 1);
  if (len < 5) return -1;
  return buf.length >= len ? len : -1;
}

// parse an incoming frame into a message object
function parseFrame(frame) {
  if (frame[0] === 0xF0) {
    return {IsPing:true, PingFrame:frame};
  }
  if (frame.length < 9) return null;
  const msgType = frame[8];
  if (frame[0] === 0xFB && frame.length === 48 && msgType === 0x00) {
    const appId = frame.toString('utf8', 16, 48).replace(/\0+$/,'');
    return {IsInit:true, AppId:appId};
  }
  const payload = frame.slice(9);
  if ([2,3,7].includes(msgType)) {
    const opReq = deserializeOpRequest(payload);
    return {OpRequest: opReq};
  }
  return null;
}

function deserializeOpRequest(buf) {
  let offset = 0;
  const opCode = buf[offset++];
  const {result: parameters, offset: newOff} = deserializeParamTableWithOffset(buf, offset);
  return {OpCode: opCode, Parameters: parameters};
}

// ── PhotonByte: force a JavaScript number to serialize as GpType.Byte (0x62) ──
// C# sends some Hashtable values as `byte` type.  Unboxing an int to byte in C#
// throws InvalidCastException, so any key that the game client reads as (byte)
// MUST be serialized with GpType.Byte or the client crashes/disconnects.
// Usage: new PhotonByte(8)  or  photonByte(8)
class PhotonByte {
  constructor(v) { this.v = (v & 0xFF); }
}
function photonByte(v) { return new PhotonByte(v); }

// write a value with its GpType prefix to a stream buffer
function writeValueWithType(stream, value) {
  if (value === null || value === undefined) {
    stream.push(Buffer.from([GpType.Null]));
    return;
  }
  if (value instanceof PhotonByte) {
    stream.push(Buffer.from([GpType.Byte, value.v]));
    return;
  }
  switch (typeof value) {
    case 'boolean':
      stream.push(Buffer.from([GpType.Boolean, value ? 1 : 0]));
      break;
    case 'number':
      if (Number.isInteger(value)) {
        const buf = Buffer.alloc(5);
        buf[0] = GpType.Integer;
        buf.writeInt32BE(value, 1);
        stream.push(buf);
      } else {
        const buf = Buffer.alloc(5);
        buf[0] = GpType.Float;
        buf.writeFloatBE(value, 1);
        stream.push(buf);
      }
      break;
    case 'string':
      writeStringWithType(stream, value);
      break;
    case 'object':
      if (Buffer.isBuffer(value)) {
        const len = value.length;
        const header = Buffer.alloc(5);
        header[0] = GpType.ByteArray;
        header.writeInt32BE(len,1);
        stream.push(Buffer.concat([header, value]));
      } else if (value instanceof Array) {
        // decide how to encode the array based on element types
        if (value.every(v => typeof v === 'string')) {
          // simple string array
          const countBuf = Buffer.alloc(2);
          countBuf.writeInt16BE(value.length,0);
          stream.push(Buffer.from([GpType.StringArray]));
          stream.push(countBuf);
          for (const s of value) {
            const p = Buffer.from(s, 'utf8');
            const lbuf = Buffer.alloc(2);
            lbuf.writeInt16BE(p.length,0);
            stream.push(lbuf);
            stream.push(p);
          }
        } else if (value.every(v => Number.isInteger(v))) {
          // optimized int array stored as typed Array with element type Integer
          const countBuf = Buffer.alloc(2);
          countBuf.writeInt16BE(value.length,0);
          stream.push(Buffer.from([GpType.Array]));
          stream.push(countBuf);
          stream.push(Buffer.from([GpType.Integer]));
          for (const n of value) {
            const ibuf = Buffer.alloc(4);
            ibuf.writeInt32BE(n,0);
            stream.push(ibuf);
          }
        } else {
          // fallback to object array, include type prefix per element
          const countBuf = Buffer.alloc(2);
          countBuf.writeInt16BE(value.length,0);
          stream.push(Buffer.from([GpType.ObjectArray]));
          stream.push(countBuf);
          for (const v of value) {
            writeValueWithType(stream, v);
          }
        }
      } else {
        // treat plain object as Photon Hashtable.
        // Keys that are purely numeric strings in 0–255 range are serialized as
        // GpType.Byte (matching C# (byte)key semantics). All others → GpType.String.
        const entries = Object.entries(value);
        const cnt = Buffer.alloc(2);
        cnt.writeInt16BE(entries.length, 0);
        stream.push(Buffer.from([GpType.Hashtable]));
        stream.push(cnt);
        for (const [k, v] of entries) {
          const asInt = parseInt(k, 10);
          if (/^\d+$/.test(k) && asInt >= 0 && asInt <= 255) {
            // byte key (matches C# (byte)key)
            stream.push(Buffer.from([GpType.Byte, asInt]));
          } else {
            writeStringWithType(stream, k);
          }
          writeValueWithType(stream, v);
        }
      }
      break;
    default:
      throw new Error(`writeValueWithType: unsupported type ${typeof value}`);
  }
}

function serializeParamTable(stream, table) {
  if (table == null || Object.keys(table).length === 0) {
    const buf = Buffer.alloc(2);
    buf.writeInt16BE(0,0);
    stream.push(buf);
    return;
  }
  const countBuf = Buffer.alloc(2);
  countBuf.writeInt16BE(Object.keys(table).length, 0);
  stream.push(countBuf);
  for (const [k, v] of Object.entries(table)) {
    const keyByte = Buffer.from([parseInt(k)]);
    stream.push(keyByte);
    writeValueWithType(stream, v);
  }
}

// read a param table and return result + new offset
// low‑level value reader returns {value, offset}
// `overrideType` can be provided when the caller already consumed the type byte (e.g. inside a typed array)
function deserializeValue(buf, offset, overrideType) {
  const type = overrideType !== undefined ? overrideType : buf[offset++];
  switch(type) {
    case GpType.Null:
      return {value: null, offset};
    case GpType.Boolean:
      return {value: buf[offset++] !== 0, offset};
    case GpType.Byte:
      return {value: buf[offset++], offset};
    case GpType.Short:
      {
        const v = buf.readInt16BE(offset); offset += 2;
        return {value: v, offset};
      }
    case GpType.Integer:
      {
        const v = buf.readInt32BE(offset); offset += 4;
        return {value: v, offset};
      }
    case GpType.Long:
      {
        // JavaScript can't represent 64-bit precisely, use Number
        let v = buf.readBigInt64BE(offset); offset += 8;
        return {value: Number(v), offset};
      }
    case GpType.Float:
      {
        const v = buf.readFloatBE(offset); offset += 4;
        return {value: v, offset};
      }
    case GpType.Double:
      {
        const v = buf.readDoubleBE(offset); offset += 8;
        return {value: v, offset};
      }
    case GpType.String:
      {
        const strlen = buf.readInt16BE(offset); offset += 2;
        const str = buf.toString('utf8', offset, offset+strlen);
        offset += strlen;
        return {value: str, offset};
      }
    case GpType.ByteArray:
      {
        const len = buf.readInt32BE(offset); offset += 4;
        const arr = buf.slice(offset, offset+len);
        offset += len;
        return {value: arr, offset};
      }
    case GpType.Array:
    case GpType.IntArray:
      {
        // typed array: count + element-type + elements (elements do NOT include their own type)
        const count = buf.readInt16BE(offset); offset += 2;
        const elemType = buf[offset++];
        const arr = [];
        for (let i=0;i<count;i++) {
          const {value: v, offset: off2} = deserializeValue(buf, offset, elemType);
          offset = off2;
          arr.push(v);
        }
        return {value: arr, offset};
      }
    case GpType.Hashtable:
      {
        const count = buf.readInt16BE(offset); offset += 2;
        const ht = {};
        for (let i=0;i<count;i++) {
          const {value: key, offset: off2} = deserializeValue(buf, offset);
          offset = off2;
          const {value: val, offset: off3} = deserializeValue(buf, offset);
          offset = off3;
          if (key != null) ht[key] = val;
        }
        return {value: ht, offset};
      }
    case GpType.ObjectArray:
      {
        const count = buf.readInt16BE(offset); offset += 2;
        const arr = [];
        for (let i=0;i<count;i++) {
          const {value: v, offset: off2} = deserializeValue(buf, offset);
          offset = off2;
          arr.push(v);
        }
        return {value: arr, offset};
      }
    case GpType.Dictionary:
      {
        const count = buf.readInt16BE(offset); offset += 2;
        const dict = {};
        for (let i=0;i<count;i++) {
          const {value: key, offset: off2} = deserializeValue(buf, offset);
          offset = off2;
          const {value: val, offset: off3} = deserializeValue(buf, offset);
          offset = off3;
          if (key != null) dict[key] = val;
        }
        return {value: dict, offset};
      }
    case GpType.StringArray:
      {
        const count = buf.readInt16BE(offset); offset += 2;
        const arr = [];
        for (let i=0;i<count;i++) {
          const len = buf.readInt16BE(offset); offset += 2;
          arr.push(buf.toString('utf8', offset, offset+len));
          offset += len;
        }
        return {value: arr, offset};
      }
    default:
      throw new Error(`deserializeValue: unsupported type ${type}`);
  }
}

function deserializeParamTableWithOffset(buf, offset=0) {
  const count = buf.readInt16BE(offset);
  offset += 2;
  const result = {};
  for (let i=0;i<count;i++) {
    const key = buf[offset++];
    const {value: val, offset: newOff} = deserializeValue(buf, offset);
    offset = newOff;
    result[key] = val;
  }
  return {result, offset};
}

// preserve original signature for convenience
function deserializeParamTable(buf, offset=0) {
  return deserializeParamTableWithOffset(buf, offset).result;
}

module.exports = {
  GpType,
  OpCode,
  ParamKey,
  EgMsgType,
  TcpMagic,
  PhotonByte,
  photonByte,
  readInt16BE,
  readInt32BE,
  writeInt16BE,
  writeInt32BE,
  writeValueWithType,
  serializeParamTable,
  deserializeParamTable,
  deserializeParamTableWithOffset,
  peekFrameSize,
  parseFrame,
  buildOpResponse,
  buildPingResponse,
  buildEvent
};
