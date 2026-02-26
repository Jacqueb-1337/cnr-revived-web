const assert = require('assert');
const {peekFrameSize, serializeParamTable, deserializeParamTable, buildOpResponse, EgMsgType, TcpMagic} = require('./protocol');

// build a fake frame with header length = 9 + payload
const payloadLen = 5;
const totalLen = 9 + payloadLen;
const buf = Buffer.alloc(totalLen);
buf[0] = 0xF3;
buf.writeInt32BE(totalLen, 1);
// rest can be zeros

assert.strictEqual(peekFrameSize(buf), totalLen, 'should detect exact frame size');
assert.strictEqual(peekFrameSize(Buffer.from([0xF0])), -1, 'ping incomplete');

// test param table roundtrip
const orig = { '248': 'hello', '239': 42 };
const pieces = [];
serializeParamTable(pieces, orig);
const combined = Buffer.concat(pieces);
const parsed = deserializeParamTable(combined, 0);
assert.strictEqual(parsed[248], 'hello');
assert.strictEqual(parsed[239], 42);

// test hashtable value inside param table
const ht = { map:'dust', version:'1.2', maxPlayers:8 };
const orig2 = { '248': ht };
const pieces2 = [];
serializeParamTable(pieces2, orig2);
const combined2 = Buffer.concat(pieces2);
const parsed2 = deserializeParamTable(combined2, 0);
assert.deepStrictEqual(parsed2[248], ht);

// byte-keyed hashtable: keys 0–255 must round-trip as byte keys
const gameProps = { 255: 10, 253: true, 254: true, 252: 0, 251: false, map: 'FreeRun3_1', mode: '0' };
const pieces2b = [];
serializeParamTable(pieces2b, { '248': gameProps });
const buf2b = Buffer.concat(pieces2b);
const parsed2b = deserializeParamTable(buf2b, 0);
// After deserialization byte key 255 becomes JS key '255'; values must match
assert.strictEqual(parsed2b[248]['255'] ?? parsed2b[248][255], 10, 'maxPlayers byte key');
assert.strictEqual(parsed2b[248]['map'], 'FreeRun3_1', 'custom string key');

// integer array round-trip
const intArr = [5, -1, 1024];
const pieces3 = [];
serializeParamTable(pieces3, { '200': intArr });
const buf3 = Buffer.concat(pieces3);
console.log('intArr frame:', buf3.toString('hex'));
let parsed3;
try {
  parsed3 = deserializeParamTable(buf3, 0);
  assert.deepStrictEqual(parsed3[200], intArr);
} catch (err) {
  console.error('failed to parse int array, buffer bytes:', buf3);
  throw err;
}

// object array round-trip
const objArr = [1, 'x', { a: 2 }];
const pieces4 = [];
serializeParamTable(pieces4, { '201': objArr });
const buf4 = Buffer.concat(pieces4);
const parsed4 = deserializeParamTable(buf4, 0);
assert.deepStrictEqual(parsed4[201], objArr);

// string array round-trip
const strArr = ['one', 'two', 'three'];
const pieces5 = [];
serializeParamTable(pieces5, { '202': strArr });
const buf5 = Buffer.concat(pieces5);
const parsed5 = deserializeParamTable(buf5, 0);
assert.deepStrictEqual(parsed5[202], strArr);

// nested dictionary/hashtable mix
const nested = { foo: { bar: 7 }, arr: [9,8] };
const pieces6 = [];
serializeParamTable(pieces6, { '203': nested });
const buf6 = Buffer.concat(pieces6);
const parsed6 = deserializeParamTable(buf6, 0);
assert.deepStrictEqual(parsed6[203], nested);

// test frame builders
const resp = serializeParamTable; // just to ensure imported
const frame = buildOpResponse(0xE0, 0, { '250': 7 }, 'ok');
// frame should start with magic and correct total length
assert.strictEqual(frame[0], TcpMagic);
assert.strictEqual(frame[8], EgMsgType.OperationResponse);

console.log('protocol tests passed');
