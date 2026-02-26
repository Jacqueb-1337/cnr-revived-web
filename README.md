# CNR LAN Server (Node.js)

This folder contains a Node.js re‑implementation of the CNR LAN Server
(Option B) originally written in C#.

## Progress so far

* `package.json` created with `start` script.
* `index.js` spins up master and game TCP listeners and logs incoming
  frames.  Basic frame size peeking logic implemented.
* `protocol.js` holds constants from the Photon binary protocol and
  helper functions (currently just BE integer readers/writers).
* `test_protocol.js` contains a tiny smoke test for frame detection.

## Getting started

```powershell
cd d:\Projects\copsnrobbers\node_server
npm install         # no dependencies yet
node test_protocol.js  # run the small unit test
npm start           # start the skeleton servers
```

## Next steps

1. Port remaining protocol serialization/deserialization routines from
   the C# `PhotonBinaryProtocol`.
2. Implement the master/game logic (room creation/listing, redirection).
3. Add additional tests to ensure parity with C# behaviour.

Contributions welcome!
