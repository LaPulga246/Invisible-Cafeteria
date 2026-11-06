# The Invisible Cafeteria v2

    npm install
    npm start          # http://localhost:3000
    npm test           # 8 safety/matching tests, no Express needed

## Roles (demo passwords, override with OP_PW / PT_PW / AD_PW)
- operator / operator123: log batches, verify food safety + set handling window
- point / point123: confirm handovers, open/close collection points
- admin / admin123: analytics, close/reopen points, reset data

## Structure
- `lib.js` forecast, SAFETY GATE, matching, handover, hash-chained audit, analytics (pure logic)
- `server.js` REST API, role auth, live updates (SSE), JSON-file persistence (data.json)
- `public/index.html` dashboard
- `test/lib.test.js` unit tests

## Safety design
1. `safetyGate()` is the only route to eligibility (verified + window + not expired).
2. Handover re-runs the gate server-side, so a batch that expired after matching cannot be handed over.
3. Filters only remove batches; they never approve one.
4. Audit log is hash-chained; tampering shows "TAMPERED".

## API
GET /api/state?now&event&diet&exclude · POST /api/login · POST /api/batches · POST /api/batches/:id/verify ·
POST /api/batches/:id/collect · POST /api/points/:i/toggle · GET /api/events (SSE)
