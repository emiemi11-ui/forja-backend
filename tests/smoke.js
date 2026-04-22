// ═══════════════════════════════════════════════════════════════════════════
//  FORJA Backend — smoke test
//  Runs against a live server (default: http://localhost:3001).
//  Usage: npm run test:smoke
//  Override URL: API_URL=https://your-api.railway.app npm run test:smoke
// ═══════════════════════════════════════════════════════════════════════════
const BASE = process.env.API_URL || 'http://localhost:3001';
const API  = `${BASE}/api`;

let pass = 0;
let fail = 0;
const failures = [];

function log(sym, msg, extra = '') {
  const color = sym === 'ok' ? '\x1b[32m' : sym === 'fail' ? '\x1b[31m' : '\x1b[33m';
  const icon  = sym === 'ok' ? '✔' : sym === 'fail' ? '✘' : '·';
  console.log(`${color}${icon}\x1b[0m ${msg}${extra ? ` ${extra}` : ''}`);
}

async function assert(name, fn) {
  try {
    await fn();
    pass++;
    log('ok', name);
  } catch (err) {
    fail++;
    failures.push({ name, err: err.message || String(err) });
    log('fail', name, `— ${err.message || err}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

function mustOk(r, name) {
  if (r.status >= 400) throw new Error(`${name}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}

async function main() {
  console.log(`\n🔎 FORJA smoke test against ${BASE}\n`);

  // ── HEALTH ──────────────────────────────────────────────────────────────
  console.log('── health ──');
  await assert('GET /health', async () => {
    const res = await fetch(`${BASE}/health`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const j = await res.json();
    if (j.status !== 'ok') throw new Error('not ok');
  });

  // ── AUTH ────────────────────────────────────────────────────────────────
  console.log('\n── auth ──');
  let userTok, coachTok, nutTok, adminTok, u1Id, c1Id;

  await assert('POST /auth/login — user', async () => {
    const d = mustOk(await req('POST', '/auth/login', { body: { email: 'user@forja.ro', password: 'demo1234' } }), 'login user');
    if (!d.token || d.user.role !== 'USER') throw new Error('bad shape');
    if (d.redirect !== '/app') throw new Error(`redirect: ${d.redirect}`);
    userTok = d.token; u1Id = d.user.id;
  });
  await assert('POST /auth/login — wrong password 401', async () => {
    const r = await req('POST', '/auth/login', { body: { email: 'user@forja.ro', password: 'wrong' } });
    if (r.status !== 401) throw new Error(`status ${r.status}`);
  });
  await assert('POST /auth/login — coach', async () => {
    const d = mustOk(await req('POST', '/auth/login', { body: { email: 'coach@forja.ro', password: 'demo1234' } }), 'login coach');
    if (d.user.role !== 'COACH') throw new Error(`role ${d.user.role}`);
    coachTok = d.token; c1Id = d.user.id;
  });
  await assert('POST /auth/login — nutritionist', async () => {
    const d = mustOk(await req('POST', '/auth/login', { body: { email: 'nutritionist@forja.ro', password: 'demo1234' } }), 'login nut');
    if (d.user.role !== 'NUTRITIONIST') throw new Error(`role ${d.user.role}`);
    nutTok = d.token;
  });
  await assert('POST /auth/login — admin', async () => {
    const d = mustOk(await req('POST', '/auth/login', { body: { email: 'admin@forja.ro', password: 'demo1234' } }), 'login admin');
    if (d.user.role !== 'ADMIN' || d.redirect !== '/admin') throw new Error('bad admin');
    adminTok = d.token;
  });
  await assert('GET /dashboard unauthenticated → 401', async () => {
    const r = await req('GET', '/dashboard');
    if (r.status !== 401) throw new Error(`got ${r.status}`);
  });

  // ── ATHLETE ─────────────────────────────────────────────────────────────
  console.log('\n── athlete surface ──');
  await assert('GET /dashboard (user)', async () => {
    const d = mustOk(await req('GET', '/dashboard', { token: userTok }), 'dashboard');
    for (const k of ['user', 'goals', 'today', 'workout', 'macros', 'exercises']) {
      if (!(k in d)) throw new Error(`missing ${k}`);
    }
    if (d.workout.progressPct === undefined || d.workout.progress_pct === undefined) {
      throw new Error('missing progressPct/progress_pct aliases');
    }
  });
  await assert('GET /user', async () => {
    const d = mustOk(await req('GET', '/user', { token: userTok }), 'user');
    if (!d.id || !d.name || !d.email) throw new Error('bad shape');
  });
  await assert('GET + PUT /goals', async () => {
    mustOk(await req('GET', '/goals', { token: userTok }), 'goals');
    const d = mustOk(await req('PUT', '/goals', { token: userTok, body: { kcal: 2400 } }), 'put goals');
    if (d.kcal !== 2400) throw new Error('kcal not updated');
  });
  await assert('POST /today/water persists', async () => {
    mustOk(await req('POST', '/today/water', { token: userTok, body: { cups: 6 } }), 'water');
    const t = mustOk(await req('GET', '/today', { token: userTok }), 'today');
    if (t.water_cups !== 6) throw new Error(`got ${t.water_cups}`);
  });
  await assert('POST /today/steps persists', async () => {
    mustOk(await req('POST', '/today/steps', { token: userTok, body: { steps: 8500 } }), 'steps');
  });
  await assert('GET /exercises (plan exists)', async () => {
    const d = mustOk(await req('GET', '/exercises', { token: userTok }), 'ex');
    if (!Array.isArray(d) || !d.length) throw new Error('no exercises');
  });
  await assert('GET /exercises/library?muscle=Piept', async () => {
    const d = mustOk(await req('GET', '/exercises/library?muscle=Piept', { token: userTok }), 'lib');
    if (!Array.isArray(d)) throw new Error('not array');
  });
  await assert('GET /sleep (history)', async () => {
    const d = mustOk(await req('GET', '/sleep', { token: userTok }), 'sleep');
    if (!Array.isArray(d.history)) throw new Error('no history');
  });
  await assert('POST /sleep/log computes score', async () => {
    const d = mustOk(await req('POST', '/sleep/log', { token: userTok, body: { bed: '23:00', wake: '07:00', quality: 4 } }), 'sleeplog');
    if (typeof d.score !== 'number') throw new Error('no score');
  });
  await assert('GET /meals', async () => {
    const d = mustOk(await req('GET', '/meals', { token: userTok }), 'meals');
    if (!Array.isArray(d)) throw new Error('bad shape');
  });

  // ── WORKOUT SESSION ─────────────────────────────────────────────────────
  console.log('\n── workout session ──');
  let exerciseId;
  await assert('POST /workout/start creates session', async () => {
    const d = mustOk(await req('POST', '/workout/start', { token: userTok }), 'start');
    if (!d.session?.id || !d.session.exercises.length) throw new Error('bad session');
    exerciseId = d.session.exercises[0].id;
  });
  await assert('GET /workout/current returns active', async () => {
    const d = mustOk(await req('GET', '/workout/current', { token: userTok }), 'current');
    if (!d.session) throw new Error('no session');
  });
  await assert('PATCH /workout/current/set increments + returns exerciseId + setsTotal', async () => {
    const d = mustOk(await req('PATCH', '/workout/current/set', { token: userTok, body: { exerciseId } }), 'set');
    if (d.setsCompleted !== 1) throw new Error(`setsCompleted ${d.setsCompleted}`);
    if (d.exerciseId !== exerciseId) throw new Error('missing exerciseId in response');
    if (typeof d.setsTotal !== 'number') throw new Error('missing setsTotal in response');
  });
  await assert('POST /workout/finish awards XP', async () => {
    const d = mustOk(await req('POST', '/workout/finish', { token: userTok }), 'finish');
    if (typeof d.xpEarned !== 'number' || !d.durationFormatted) throw new Error('bad shape');
  });

  // ── FEED ────────────────────────────────────────────────────────────────
  console.log('\n── feed ──');
  let postId;
  await assert('GET /feed', async () => {
    const d = mustOk(await req('GET', '/feed', { token: userTok }), 'feed');
    if (!Array.isArray(d) || !d.length) throw new Error('empty feed');
    postId = d[0].id;
    if (!('liked' in d[0]) || !('likes' in d[0])) throw new Error('missing liked/likes');
  });
  await assert('POST /feed/:id/like toggles + returns real liked state', async () => {
    const d = mustOk(await req('POST', `/feed/${postId}/like`, { token: userTok }), 'like');
    if (typeof d.liked !== 'boolean' || typeof d.likes !== 'number') throw new Error('bad shape');
  });
  await assert('POST /feed/:id/comment', async () => {
    const d = mustOk(await req('POST', `/feed/${postId}/comment`, { token: userTok, body: { content: 'Smoke comment' } }), 'comment');
    if (!d.id) throw new Error('no id');
  });

  // ── TEAMS ───────────────────────────────────────────────────────────────
  console.log('\n── teams ──');
  await assert('GET /teams?filter=mine', async () => {
    const d = mustOk(await req('GET', '/teams?filter=mine', { token: userTok }), 'mine');
    if (!Array.isArray(d) || !d.length) throw new Error('no teams');
    if (!d.every((t) => t.isMember)) throw new Error('filter broken');
  });
  await assert('GET /teams/:id', async () => {
    const teams = mustOk(await req('GET', '/teams?filter=mine', { token: userTok }), 'mine');
    const t = mustOk(await req('GET', `/teams/${teams[0].id}`, { token: userTok }), 'detail');
    if (!Array.isArray(t.members) || !Array.isArray(t.posts)) throw new Error('bad shape');
  });

  // ── DMs ─────────────────────────────────────────────────────────────────
  console.log('\n── DMs ──');
  let convId;
  await assert('POST /messages/start (u1 → c1)', async () => {
    const d = mustOk(await req('POST', '/messages/start', { token: userTok, body: { targetUserId: c1Id } }), 'start');
    if (!d.conversationId) throw new Error('no id');
    convId = d.conversationId;
  });
  await assert('GET /messages/:id + POST /messages/:id', async () => {
    const g = mustOk(await req('GET', `/messages/${convId}`, { token: userTok }), 'get');
    if (!g.conversation?.id || !Array.isArray(g.messages)) throw new Error('bad shape');
    const sent = mustOk(await req('POST', `/messages/${convId}`, { token: userTok, body: { message: 'smoke test' } }), 'post');
    if (!sent.id || !sent.isMe) throw new Error('bad shape');
  });
  await assert('GET /messages/conversations', async () => {
    const d = mustOk(await req('GET', '/messages/conversations', { token: userTok }), 'conv');
    if (!Array.isArray(d)) throw new Error('bad shape');
  });

  // ── CHAT (team) ─────────────────────────────────────────────────────────
  console.log('\n── team chat ──');
  await assert('GET /chat + POST /chat', async () => {
    const g = mustOk(await req('GET', '/chat', { token: userTok }), 'chat get');
    if (!Array.isArray(g.messages)) throw new Error('bad shape');
    const sent = mustOk(await req('POST', '/chat', { token: userTok, body: { msg: 'smoke chat' } }), 'chat post');
    if (!sent.id) throw new Error('no id');
  });

  // ── DISCOVER ────────────────────────────────────────────────────────────
  console.log('\n── discover ──');
  await assert('GET /discover?role=COACH', async () => {
    const d = mustOk(await req('GET', '/discover?role=COACH', { token: userTok }), 'discover');
    if (!Array.isArray(d) || !d.length) throw new Error('empty');
  });

  // ── COACH ───────────────────────────────────────────────────────────────
  console.log('\n── coach ──');
  await assert('GET /coach/team', async () => {
    mustOk(await req('GET', '/coach/team', { token: coachTok }), 'coach team');
  });
  await assert('GET /coach/athletes', async () => {
    const d = mustOk(await req('GET', '/coach/athletes', { token: coachTok }), 'athletes');
    if (!Array.isArray(d) || !d.length) throw new Error('empty');
  });
  await assert('coach endpoint rejects non-coach (403)', async () => {
    const r = await req('GET', '/coach/team', { token: userTok });
    if (r.status !== 403) throw new Error(`got ${r.status}`);
  });

  // ── NUTRITIONIST ────────────────────────────────────────────────────────
  console.log('\n── nutritionist ──');
  await assert('GET /nutritionist/overview', async () => {
    mustOk(await req('GET', '/nutritionist/overview', { token: nutTok }), 'overview');
  });
  await assert('GET /nutritionist/templates', async () => {
    const d = mustOk(await req('GET', '/nutritionist/templates', { token: nutTok }), 'templates');
    if (!Array.isArray(d) || !d.length) throw new Error('empty');
  });

  // ── ADMIN ───────────────────────────────────────────────────────────────
  console.log('\n── admin ──');
  await assert('GET /admin/overview', async () => {
    const d = mustOk(await req('GET', '/admin/overview', { token: adminTok }), 'overview');
    if (!d.kpis?.totalUsers) throw new Error('no kpis');
  });
  await assert('GET /admin/users', async () => {
    const d = mustOk(await req('GET', '/admin/users', { token: adminTok }), 'users');
    if (!d.users?.length) throw new Error('no users');
  });
  await assert('GET /admin/settings + PUT', async () => {
    mustOk(await req('GET', '/admin/settings', { token: adminTok }), 'get settings');
    mustOk(await req('PUT', '/admin/settings', { token: adminTok, body: { allowContact: true, maintenanceMode: false } }), 'put settings');
  });
  await assert('GET /admin/audit', async () => {
    const d = mustOk(await req('GET', '/admin/audit', { token: adminTok }), 'audit');
    if (!Array.isArray(d)) throw new Error('bad shape');
  });
  await assert('admin endpoint rejects non-admin (403)', async () => {
    const r = await req('GET', '/admin/overview', { token: userTok });
    if (r.status !== 403) throw new Error(`got ${r.status}`);
  });

  // ── PUBLIC ──────────────────────────────────────────────────────────────
  console.log('\n── public ──');
  await assert('GET /settings/public', async () => {
    mustOk(await req('GET', '/settings/public'), 'pub');
  });
  await assert('POST /contact', async () => {
    mustOk(await req('POST', '/contact', { body: { name: 'Smoke', email: 'smoke@test.ro', message: 'hello', subject: 'hi' } }), 'contact');
  });
  await assert('POST /waitlist', async () => {
    mustOk(await req('POST', '/waitlist', { body: { email: 'wait@smoke.ro' } }), 'waitlist');
  });

  // ── REGISTRATION ────────────────────────────────────────────────────────
  console.log('\n── register ──');
  await assert('POST /auth/register creates user', async () => {
    const email = `smoke-${Date.now()}@test.ro`;
    const d = mustOk(await req('POST', '/auth/register', { body: { name: 'Smoke New', email, password: 'secret123', role: 'USER' } }), 'register');
    if (!d.token) throw new Error('no token');
  });
  await assert('POST /auth/register rejects duplicate (409)', async () => {
    const r = await req('POST', '/auth/register', { body: { name: 'Dup', email: 'user@forja.ro', password: 'x123456' } });
    if (r.status !== 409) throw new Error(`got ${r.status}`);
  });

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  console.log('\n───────────────────────────────────────────────');
  console.log(`\x1b[32m✔ ${pass} passed\x1b[0m  \x1b[31m✘ ${fail} failed\x1b[0m\n`);
  if (fail) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f.name}\n    ${f.err}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
