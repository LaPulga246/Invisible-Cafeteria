// Pure business logic (no Express) so it can be unit-tested.
const crypto = require('crypto');
const COUNTERS = ['Main Hall', 'Engineering Cafe', 'Library Cafe', 'Hostel Mess'];
const ITEMS = [
  ['Main Hall','Veg Biryani',[220,240,210,230],300,232,[],'veg'],
  ['Main Hall','Paneer Curry',[120,130,110,125],180,118,['dairy'],'veg'],
  ['Engineering Cafe','Chicken Wrap',[80,90,85,95],130,92,['gluten'],'nonveg'],
  ['Engineering Cafe','Veg Sandwich',[100,95,110,105],140,108,['gluten','dairy'],'veg'],
  ['Library Cafe','Peanut Cookies',[60,55,65,50],90,58,['nuts','gluten'],'veg'],
  ['Library Cafe','Fruit Salad',[40,45,35,40],60,41,[],'vegan'],
  ['Hostel Mess','Dal Rice',[300,310,290,320],400,312,[],'veg'],
  ['Hostel Mess','Idli',[150,140,160,145],200,148,[],'vegan'],
].map(([counter,name,hist,prepared,actual,allergens,diet]) => ({counter,name,hist,prepared,actual,allergens,diet}));

const seed = () => ({
  batches: [['S1','Veg Biryani',60,720,180,'R. Kumar'],['S2','Paneer Curry',50,730,120,'R. Kumar'],
    ['S3','Chicken Wrap',30,705,120,'S. Iyer'],['S4','Veg Sandwich',28,735,150,null],
    ['S5','Peanut Cookies',25,720,360,'S. Iyer'],['S6','Fruit Salad',18,690,90,'S. Iyer'],
    ['S7','Dal Rice',80,750,180,'M. Das'],['S8','Idli',45,720,null,null]]
    .map(([id,item,qty,cooked,window,verifiedBy]) => ({id,item,qty,cooked,window,verifiedBy,collected:null})),
  points: [
    {name:'Community Fridge (A-Block)',cap:80,load:20,open:true,close:1020,diet:'any',exclude:[],travel:[10,15,5,20]},
    {name:'NGO Pickup (Gate 2)',cap:120,load:0,open:true,close:840,diet:'any',exclude:[],travel:[15,10,20,25]},
    {name:'Night Shelter Van',cap:60,load:10,open:true,close:930,diet:'veg',exclude:[],travel:[25,30,25,15]},
    {name:'Hostel Sharing Shelf',cap:50,load:40,open:true,close:1080,diet:'any',exclude:['nuts'],travel:[20,25,20,5]}],
  audit: [],
});
const hhmm = m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
const itemOf = b => ITEMS.find(i => i.name === b.item);

// ---- forecast: weighted avg + damped trend, x event; 80th-percentile prep recommendation ----
const W = [4,3,2,1];
function forecast(it, ev = 1) {
  const n = it.hist.length, base = it.hist.reduce((a,v,k) => a + v*W[k], 0) / W.reduce((a,b) => a+b);
  const slope = (it.hist[n-1] - it.hist[0]) / (n-1), mean = it.hist.reduce((a,b) => a+b) / n;
  const sd = Math.sqrt(it.hist.reduce((a,v) => a + (v-mean)**2, 0) / (n-1));
  const f = (base + 0.5*slope) * ev;
  return { forecast: Math.round(f), low: Math.round(f - 1.28*sd*ev), high: Math.round(f + 1.28*sd*ev),
           recommended: Math.round(f + 0.84*sd*ev), sd: Math.round(sd) };
}

// ---- SAFETY GATE: sole route to eligibility ----
function safetyGate(b, now) {
  if (!b.verifiedBy) return 'Blocked: awaiting operator verification.';
  if (!(b.window > 0)) return 'Blocked: no approved handling window recorded.';
  if (now >= b.cooked + b.window) return `Blocked: approved window ended at ${hhmm(b.cooked + b.window)}.`;
  return null;
}

// ---- matching: earliest-expiry first; arrival ties broken by emptier point ----
function match(st, now, diet = 'any', exclude = []) {
  const used = st.points.map(() => 0);
  const order = [...st.batches].sort((a,b) => (a.window ? a.cooked+a.window : 1e9) - (b.window ? b.cooked+b.window : 1e9));
  const results = order.map(b => {
    const it = itemOf(b), exp = b.window ? b.cooked + b.window : null;
    const r = { id:b.id, item:b.item, counter:it.counter, qty:b.qty, diet:it.diet, allergens:it.allergens,
                cooked:b.cooked, expiresAt:exp, verifiedBy:b.verifiedBy, placed:[], left:b.qty };
    if (b.collected) return { ...r, status:'collected', left:0, placed:b.collected, why:`Collected: ${b.collected.map(x=>x.qty+' at '+x.point).join('; ')}.` };
    const blocked = safetyGate(b, now);
    if (blocked) return { ...r, status:'blocked', why:blocked };
    if ((diet==='veg' && it.diet==='nonveg') || (diet==='vegan' && it.diet!=='vegan')) return { ...r, status:'filtered', why:'Excluded by dietary filter.' };
    const bad = it.allergens.filter(a => exclude.includes(a));
    if (bad.length) return { ...r, status:'filtered', why:'Excluded by allergen filter: ' + bad.join(', ') };
    const ci = COUNTERS.indexOf(it.counter), rej = [];
    st.points.map((p,i) => ({p,i,arrive:now+p.travel[ci]}))
      .sort((a,b) => a.arrive-b.arrive || (a.p.load+used[a.i])/a.p.cap - (b.p.load+used[b.i])/b.p.cap)
      .forEach(({p,i,arrive}) => {
        if (r.left <= 0) return;
        if (!p.open) return rej.push(`${p.name}: closed`);
        if (arrive > exp) return rej.push(`${p.name}: arrival ${hhmm(arrive)} after window`);
        if (arrive > p.close) return rej.push(`${p.name}: closes ${hhmm(p.close)}`);
        if (p.diet==='veg' && it.diet==='nonveg') return rej.push(`${p.name}: veg only`);
        if (p.exclude.some(a => it.allergens.includes(a))) return rej.push(`${p.name}: allergen rule`);
        const room = p.cap - p.load - used[i];
        if (room <= 0) return rej.push(`${p.name}: full`);
        const t = Math.min(room, r.left); used[i] += t; r.left -= t; r.placed.push({ point:p.name, qty:t, arrive });
      });
    const status = r.left === 0 ? 'done' : r.placed.length ? 'part' : 'nomatch';
    return { ...r, status, why:`Verified by ${b.verifiedBy}. ` + r.placed.map(x => `${x.qty} to ${x.point} (arrive ${hhmm(x.arrive)})`).join('; ')
      + (r.left ? ` ${r.left} unplaced. ` + rej.join('; ') : '') };
  });
  return { results, matched: st.points.map((p,i) => ({ ...p, matched: used[i] })) };
}

// ---- pickup confirmation: gate is RE-CHECKED at the moment of handover ----
function confirmPickup(st, id, now, actor) {
  const b = st.batches.find(x => x.id === id); if (!b) throw new Error('batch not found');
  if (b.collected) throw new Error('already collected');
  const gate = safetyGate(b, now); if (gate) throw new Error(gate);
  const r = match(st, now).results.find(x => x.id === id);
  if (!r.placed.length) throw new Error('no collection point can currently receive this batch');
  r.placed.forEach(x => { st.points.find(p => p.name === x.point).load += x.qty; });
  b.collected = r.placed; addAudit(st, actor, `Batch ${id} handed over: ${r.placed.map(x => x.qty+' to '+x.point).join(', ')}`);
  return r.placed;
}

// ---- tamper-evident audit log (hash chain) ----
const hash = (...p) => crypto.createHash('sha256').update(p.join('|')).digest('hex');
function addAudit(st, actor, msg) {
  const prev = st.audit.length ? st.audit[st.audit.length-1].hash : 'GENESIS', at = new Date().toISOString();
  st.audit.push({ at, actor, msg, prev, hash: hash(prev, at, actor, msg) });
}
const verifyChain = st => st.audit.every((e,i) => e.prev === (i ? st.audit[i-1].hash : 'GENESIS') && e.hash === hash(e.prev, e.at, e.actor, e.msg));

// ---- analytics ----
function analytics(st, ev, now) {
  const items = ITEMS.map(i => ({ ...i, ...forecast(i, ev) }));
  const mape = f => items.reduce((a,i) => a + Math.abs(f(i) - i.actual) / i.actual, 0) / items.length * 100;
  const { results } = match(st, now);
  const confirmed = results.filter(r => r.status === 'collected').reduce((a,r) => a + r.qty, 0);
  const proposed = results.filter(r => r.status === 'done' || r.status === 'part').reduce((a,r) => a + r.qty - r.left, 0);
  const overPrep = items.reduce((a,i) => a + Math.max(0, i.prepared - i.actual), 0);
  const overPrepAfter = items.reduce((a,i) => a + Math.max(0, i.recommended - i.actual), 0);
  const stockouts = items.filter(i => i.recommended < i.actual).length;
  return { items, mapeModel: +mape(i => i.forecast).toFixed(1), mapeCurrent: +mape(i => i.prepared).toFixed(1),
           confirmed, proposed, overPrep, overPrepAfter, stockouts, auditOk: verifyChain(st) };
}
module.exports = { COUNTERS, ITEMS, seed, forecast, safetyGate, match, confirmPickup, addAudit, verifyChain, analytics, itemOf, hhmm };
