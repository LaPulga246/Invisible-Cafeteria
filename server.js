const express = require('express'), fs = require('fs'), crypto = require('crypto');
const L = require('./lib');
const FILE = 'data.json';
let st = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : L.seed();
const save = () => fs.writeFileSync(FILE, JSON.stringify(st, null, 1));

// Demo accounts. Change via env vars for any real use.
const USERS = {
  operator: { pw: process.env.OP_PW || 'operator123', role: 'operator', name: 'Operator' },
  point:    { pw: process.env.PT_PW || 'point123',    role: 'point',    name: 'Collection point' },
  admin:    { pw: process.env.AD_PW || 'admin123',    role: 'admin',    name: 'Administrator' },
};
const tokens = new Map(), clients = [];
const app = express(); app.use(express.json()); app.use(express.static('public'));
const push = () => clients.forEach(c => c.write('data: change\n\n'));
const done = (res, data) => { save(); push(); res.json(data); };
const user = (req, _res, next) => { req.user = tokens.get((req.headers.authorization || '').slice(7)) || null; next(); };
const need = (...roles) => (req, res, next) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(req.user ? 403 : 401).json({ error: `requires role: ${roles.join(' or ')}` });
app.use(user);

app.post('/api/login', (req, res) => {
  const u = USERS[req.body.username];
  if (!u || u.pw !== req.body.password) return res.status(401).json({ error: 'invalid credentials' });
  const t = crypto.randomBytes(16).toString('hex'); tokens.set(t, u); res.json({ token: t, role: u.role });
});
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
  clients.push(res); req.on('close', () => clients.splice(clients.indexOf(res), 1));
});
app.get('/api/state', (req, res) => {
  const now = +req.query.now || 810, ev = +req.query.event || 1, ex = (req.query.exclude || '').split(',').filter(Boolean);
  const m = L.match(st, now, req.query.diet || 'any', ex);
  res.json({ me: req.user && req.user.role, batches: m.results, points: m.matched,
             analytics: L.analytics(st, ev, now), audit: st.audit.slice(-12).reverse() });
});
app.post('/api/batches', need('operator'), (req, res) => {
  const { item, qty, cooked } = req.body;
  if (!L.ITEMS.some(i => i.name === item) || !(qty > 0)) return res.status(400).json({ error: 'valid item and qty required' });
  const b = { id: 'S' + (st.batches.length + 1), item, qty: +qty, cooked: +cooked || 720, window: null, verifiedBy: null, collected: null };
  st.batches.push(b); L.addAudit(st, req.user.name, `Batch ${b.id} logged (unverified)`); done(res, b);
});
app.post('/api/batches/:id/verify', need('operator'), (req, res) => {
  const b = st.batches.find(x => x.id === req.params.id), { operator, windowMinutes } = req.body;
  if (!b) return res.status(404).json({ error: 'not found' });
  if (b.collected) return res.status(409).json({ error: 'already collected' });
  if (!operator || !(windowMinutes > 0)) return res.status(400).json({ error: 'operator name and positive handling window required' });
  b.verifiedBy = operator; b.window = +windowMinutes;
  L.addAudit(st, req.user.name, `Batch ${b.id} verified by ${operator}, window ${windowMinutes} min`); done(res, b);
});
app.post('/api/batches/:id/collect', need('point', 'operator'), (req, res) => {
  try { done(res, L.confirmPickup(st, req.params.id, +req.body.now || 810, req.user.name)); }
  catch (e) { res.status(409).json({ error: e.message }); }
});
app.post('/api/points/:i/toggle', need('point', 'admin'), (req, res) => {
  const p = st.points[+req.params.i]; if (!p) return res.status(404).end();
  p.open = !p.open; L.addAudit(st, req.user.name, `${p.name} ${p.open ? 'reopened' : 'closed'}`); done(res, p);
});
app.post('/api/reset', need('admin'), (_req, res) => { st = L.seed(); done(res, { ok: true }); });
if (require.main === module) app.listen(3000, () => console.log('Open http://localhost:3000'));
module.exports = app;
