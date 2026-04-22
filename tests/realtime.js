// ═══════════════════════════════════════════════════════════════════════════
//  FORJA — realtime DM delivery test
//  Verifies the Socket.IO `dm:new` event fires correctly when a DM is sent
//  via HTTP. Matches what the frontend's DirectMessagesPage.jsx listens for.
// ═══════════════════════════════════════════════════════════════════════════
import { io } from 'socket.io-client';

const BASE = process.env.API_URL || 'http://localhost:3001';
const API  = `${BASE}/api`;

async function login(email, password) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return r.json();
}

const TIMEOUT_MS = 5000;

async function main() {
  console.log(`\n🔌 FORJA realtime test against ${BASE}\n`);

  const u1 = await login('user@forja.ro', 'demo1234');
  const c1 = await login('coach@forja.ro', 'demo1234');
  if (!u1.token || !c1.token) throw new Error('login failed');

  // Coach opens a WebSocket; Alex will send him a DM via HTTP.
  const coachSocket = io(BASE, { auth: { token: c1.token }, transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 3000);
    coachSocket.on('connect', () => { clearTimeout(t); resolve(); });
    coachSocket.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
  console.log('✔ coach socket connected');

  // Start conversation (from u1's side)
  const start = await fetch(`${API}/messages/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.token}` },
    body: JSON.stringify({ targetUserId: c1.user.id }),
  }).then((r) => r.json());
  if (!start.conversationId) throw new Error('no conv id');
  console.log(`✔ conversation ${start.conversationId}`);

  // Arm the listener
  const gotMsg = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dm:new not received in time')), TIMEOUT_MS);
    coachSocket.on('dm:new', (payload) => { clearTimeout(t); resolve(payload); });
  });

  // Send the DM via HTTP (this is what the React app does)
  const sentAt = Date.now();
  const sent = await fetch(`${API}/messages/${start.conversationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.token}` },
    body: JSON.stringify({ message: 'Realtime smoke test' }),
  }).then((r) => r.json());
  console.log(`✔ u1 posted DM id=${sent.id}`);

  const received = await gotMsg;
  const latency = Date.now() - sentAt;

  if (received.conversationId !== start.conversationId) {
    throw new Error(`wrong conv: ${received.conversationId}`);
  }
  if (!received.message?.id) throw new Error('missing message.id');
  if (received.message.isMe !== false) throw new Error('isMe should be false on recipient');

  console.log(`✔ coach received dm:new in ${latency}ms: "${received.message.message}"`);

  coachSocket.disconnect();
  console.log('\n✔ realtime test PASSED\n');
}

main().catch((e) => { console.error('✘', e.message); process.exit(1); });
