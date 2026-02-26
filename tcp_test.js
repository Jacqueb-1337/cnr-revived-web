const net = require('net');
const sock = net.createConnection({host:'172.28.48.1', port:5056}, () => {
  console.log('connected to game server');
  sock.end();
});
sock.on('error', e => { console.error('connection error', e.message); });
sock.on('close', () => { console.log('socket closed'); });
