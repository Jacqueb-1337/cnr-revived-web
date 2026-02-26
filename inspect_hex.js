const proto = require('./protocol');
const buf = Buffer.from('f3000000230000f303e300002a0001e67300103137322e32382e34382e313a35303536','hex');
console.log('frame', buf);
// manually interpret as operation response
const payload = buf.slice(9);
const opCode = payload[0];
const returnCode = payload.readInt16BE(1);
const debugType = payload[3];
let offset = 4;
if (debugType !== proto.GpType.Null) {
  // skip string
  const len = payload.readInt16BE(offset); offset += 2;
  offset += len;
}
const params = proto.deserializeParamTable(payload.slice(offset));
console.log('frame interpreted as OpResp opcode', opCode, 'returnCode', returnCode, 'params', params);
