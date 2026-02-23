// ══════════════════════════════════════════════════════════════
// SALES PORTAL v9 — Azure Function API (v5 - 800K READY)
//
// Designed for 800K+ MasterData rows:
// 1. Customer summaries computed in SQL (not JS) — O(1) memory
// 2. Dedicated customer detail endpoint — loads 1 customer at a time
// 3. Server-side filters — browser never holds full dataset
// 4. Lightweight summary cache (small objects only)
// 5. Parallel queries + connection pool reuse
// 6. Auto-reconnect on connection drop
//
// ENDPOINTS:
//   ?action=login&code=X              → user + salesmen/sup/bsm + customerSummary
//   ?action=login&code=X&summary=1    → same but NO raw masterData (fast)
//   ?action=customerDetail&code=X&customer=Y  → full rows for 1 customer
//   ?action=clearCache                → bust server cache
//   ?action=getUsers                  → all users
// ══════════════════════════════════════════════════════════════

const sql = require('mssql');

// ── CONFIG ──
function getConfig() {
    return process.env.SQL_CONNECTION_STRING || {
        server: process.env.SQL_SERVER,
        database: process.env.SQL_DATABASE,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        options: { encrypt: true, trustServerCertificate: false }
    };
}

let pool = null;
async function getPool() {
    if (pool) {
        try { await pool.request().query('SELECT 1'); return pool; }
        catch (e) { pool = null; }
    }
    pool = await sql.connect(getConfig());
    return pool;
}

// ── CACHE (summaries only — small footprint) ──
const cache = {};
const CACHE_TTL = 5 * 60 * 1000;
function cacheGet(key) {
    const e = cache[key];
    if (!e) return null;
    if (Date.now() - e.time > CACHE_TTL) { delete cache[key]; return null; }
    return e.data;
}
function cacheSet(key, data) {
    cache[key] = { data, time: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > 200) {
        keys.sort((a, b) => cache[a].time - cache[b].time);
        for (let i = 0; i < keys.length - 100; i++) delete cache[keys[i]];
    }
}

// ── HELPER: build salesman code WHERE clause ──
function buildSmCodeFilter(db, smCodes, bsmCode) {
    if (!smCodes.length && !bsmCode) return { req: null, clause: '1=0' };
    const req = db.request();
    const parts = [];
    if (smCodes.length) {
        const ph = smCodes.map((_, i) => `@sc${i}`).join(',');
        smCodes.forEach((c, i) => req.input(`sc${i}`, sql.NVarChar, c));
        parts.push(`LTRIM(RTRIM([Salesman Code])) IN (${ph})`);
    }
    if (bsmCode) {
        req.input('bsmCode', sql.NVarChar, bsmCode);
        parts.push(`LTRIM(RTRIM([Supervisor Code])) = LTRIM(RTRIM(@bsmCode))`);
    }
    return { req, clause: parts.join(' OR ') };
}

// ── SQL AGGREGATION: customer summaries directly in DB ──
async function sqlCustomerSummary(db, smCodes, bsmCode) {
    const { req, clause } = buildSmCodeFilter(db, smCodes, bsmCode);
    if (!req) return [];

    const result = await req.query(`
        SELECT
            LTRIM(RTRIM([Customer Code])) AS customerCode,
            MAX([Customer]) AS customer,
            LTRIM(RTRIM(MAX([Salesman Code]))) AS salesmanCode,
            LTRIM(RTRIM(MAX([Route Code]))) AS routeCode,
            MAX([Sector]) AS sector,
            MAX([Class]) AS cls,
            ISNULL(SUM(CAST([L3S] AS FLOAT)), 0) AS totalL3S,
            ISNULL(SUM(CAST([L6S] AS FLOAT)), 0) AS totalL6S,
            ISNULL(SUM(CAST([ACT-CY] AS FLOAT)), 0) AS totalCY,
            ISNULL(SUM(CAST([ACT-LY] AS FLOAT)), 0) AS totalLY,
            ISNULL(SUM(CAST([ACH CY (P)] AS FLOAT)), 0) AS totalACHCY,
            ISNULL(SUM(CAST([ACH LY (P)] AS FLOAT)), 0) AS totalACHLY,
            COUNT(*) AS rowCount
        FROM MasterData
        WHERE ${clause}
        GROUP BY LTRIM(RTRIM([Customer Code]))
    `);

    const summaries = result.recordset.map(r => ({
        ...r,
        varPct: r.totalLY ? ((r.totalCY - r.totalLY) / r.totalLY * 100) : 0
    }));
    return summaries;
}

// ── SQL: get detail rows for a single customer ──
async function sqlCustomerDetail(db, customerCode, smCodes, bsmCode) {
    const { req, clause } = buildSmCodeFilter(db, smCodes, bsmCode);
    if (!req) return [];
    req.input('custCode', sql.NVarChar, customerCode);

    const result = await req.query(`
        SELECT * FROM MasterData
        WHERE LTRIM(RTRIM([Customer Code])) = LTRIM(RTRIM(@custCode))
        AND (${clause})
        ORDER BY [Date], [Brand], [Product]
    `);
    return result.recordset;
}

// ── MAIN HANDLER ──
module.exports = async function (context, req) {
    context.res = {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'public, max-age=300'
        }
    };

    if (req.method === 'OPTIONS') { context.res.status = 204; context.res.body = ''; return; }

    const t0 = Date.now();

    try {
        const action = (req.query.action || '').toLowerCase();
        const code = (req.query.code || '').trim();
        const noCache = req.query.nocache === '1';
        const summaryMode = req.query.summary !== '0'; // default ON now

        // ══════════════════════════════════════
        // LOGIN — returns user + hierarchy + customer summaries
        // ══════════════════════════════════════
        if (action === 'login') {
            if (!code) { context.res.body = JSON.stringify({ error: 'Code required' }); return; }

            const cacheKey = `v5_${code}`;
            if (!noCache) {
                const cached = cacheGet(cacheKey);
                if (cached) {
                    context.log(`Cache HIT for ${code} (${Date.now() - t0}ms)`);
                    context.res.body = JSON.stringify(cached);
                    return;
                }
            }

            const db = await getPool();
            let result = {};

            // Find user
            const userRes = await db.request()
                .input('code', sql.NVarChar, code)
                .query('SELECT [User Code],[User Name],[Role] FROM Users WHERE LTRIM(RTRIM([User Code])) = LTRIM(RTRIM(@code))');

            if (!userRes.recordset.length) {
                context.res.body = JSON.stringify({ error: 'User not found', code });
                return;
            }

            const user = userRes.recordset[0];
            result.user = user;
            const role = (user.Role || '').toLowerCase().trim();

            // ── SALESMAN ──
            if (role === 'salesman') {
                const [sm, cs] = await Promise.all([
                    db.request().input('code', sql.NVarChar, code)
                        .query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Salesman Code])) = LTRIM(RTRIM(@code))'),
                    sqlCustomerSummary(db, [code], null)
                ]);
                result.salesmenData = sm.recordset;
                result.customerSummary = cs;
                result.masterDataTotal = cs.reduce((a, c) => a + c.rowCount, 0);
            }

            // ── SUPERVISOR ──
            else if (role === 'supervisor') {
                const sm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))');
                result.salesmenData = sm.recordset;

                const smCodes = sm.recordset.map(r => String(r['Salesman Code']).trim());
                result.customerSummary = await sqlCustomerSummary(db, smCodes, null);
                result.masterDataTotal = result.customerSummary.reduce((a, c) => a + c.rowCount, 0);
            }

            // ── BSM ──
            else if (role === 'bsm') {
                const [sup, bsm, directSm] = await Promise.all([
                    db.request().input('code', sql.NVarChar, code)
                        .query('SELECT * FROM SUPdata WHERE LTRIM(RTRIM([AssignedBSM])) = LTRIM(RTRIM(@code))'),
                    db.request().input('code', sql.NVarChar, code)
                        .query('SELECT * FROM BSMdata WHERE LTRIM(RTRIM([BSM Code])) = LTRIM(RTRIM(@code))'),
                    db.request().input('code', sql.NVarChar, code)
                        .query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))')
                ]);
                result.supData = sup.recordset;
                result.bsmData = bsm.recordset;

                const spvCodes = sup.recordset.map(r => String(r['Supervisor Code']).trim());
                let smFromSup = [];
                if (spvCodes.length) {
                    const ph = spvCodes.map((_, i) => `@sp${i}`).join(',');
                    const smReq = db.request();
                    spvCodes.forEach((c, i) => smReq.input(`sp${i}`, sql.NVarChar, c));
                    const sm = await smReq.query(`SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) IN (${ph})`);
                    smFromSup = sm.recordset;
                }

                // Deduplicate salesmen
                const smMap = {};
                [...smFromSup, ...directSm.recordset].forEach(r => {
                    smMap[String(r['Salesman Code']).trim()] = r;
                });
                result.salesmenData = Object.values(smMap);
                const smCodes = Object.keys(smMap);

                // SQL aggregation — never loads 800K rows into memory
                result.customerSummary = await sqlCustomerSummary(db, smCodes, code);
                result.masterDataTotal = result.customerSummary.reduce((a, c) => a + c.rowCount, 0);
            }

            // ── MANAGEMENT ──
            else if (role === 'management') {
                const all = await db.request().query('SELECT [User Code],[User Name],[Role] FROM Users');
                result.allUsers = all.recordset;
            }

            // Cache the lightweight result (no raw masterData)
            cacheSet(cacheKey, result);

            context.log(`Login ${code} (${role}): ${result.customerSummary ? result.customerSummary.length : 0} customers, ${result.masterDataTotal || 0} rows, ${Date.now() - t0}ms`);
            context.res.body = JSON.stringify(result);
            return;
        }

        // ══════════════════════════════════════
        // CUSTOMER DETAIL — returns full rows for ONE customer
        // ══════════════════════════════════════
        if (action === 'customerdetail') {
            const customerCode = (req.query.customer || '').trim();
            if (!code || !customerCode) {
                context.res.body = JSON.stringify({ error: 'code and customer params required' });
                return;
            }

            const db = await getPool();

            // Find user to determine scope
            const userRes = await db.request()
                .input('code', sql.NVarChar, code)
                .query('SELECT [User Code],[User Name],[Role] FROM Users WHERE LTRIM(RTRIM([User Code])) = LTRIM(RTRIM(@code))');
            if (!userRes.recordset.length) {
                context.res.body = JSON.stringify({ error: 'User not found' });
                return;
            }

            const role = (userRes.recordset[0].Role || '').toLowerCase().trim();
            let smCodes = [];
            let bsmCode = null;

            if (role === 'salesman') {
                smCodes = [code];
            } else if (role === 'supervisor') {
                const sm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT [Salesman Code] FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))');
                smCodes = sm.recordset.map(r => String(r['Salesman Code']).trim());
            } else if (role === 'bsm') {
                bsmCode = code;
                const sup = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT [Supervisor Code] FROM SUPdata WHERE LTRIM(RTRIM([AssignedBSM])) = LTRIM(RTRIM(@code))');
                const spvCodes = sup.recordset.map(r => String(r['Supervisor Code']).trim());

                // Salesmen under supervisors
                if (spvCodes.length) {
                    const ph = spvCodes.map((_, i) => `@sp${i}`).join(',');
                    const smReq = db.request();
                    spvCodes.forEach((c, i) => smReq.input(`sp${i}`, sql.NVarChar, c));
                    const sm = await smReq.query(`SELECT [Salesman Code] FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) IN (${ph})`);
                    smCodes = sm.recordset.map(r => String(r['Salesman Code']).trim());
                }
                // Direct salesmen under BSM
                const directSm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT [Salesman Code] FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))');
                directSm.recordset.forEach(r => {
                    const sc = String(r['Salesman Code']).trim();
                    if (!smCodes.includes(sc)) smCodes.push(sc);
                });
            }

            const rows = await sqlCustomerDetail(db, customerCode, smCodes, bsmCode);
            context.log(`CustomerDetail ${customerCode} for ${code}: ${rows.length} rows, ${Date.now() - t0}ms`);
            context.res.body = JSON.stringify({ rows, total: rows.length });
            return;
        }

        // ══════════════════════════════════════
        // CLEAR CACHE
        // ══════════════════════════════════════
        if (action === 'clearcache') {
            Object.keys(cache).forEach(k => delete cache[k]);
            context.res.body = JSON.stringify({ success: true, message: 'Cache cleared' });
            return;
        }

        // ══════════════════════════════════════
        // GET USERS
        // ══════════════════════════════════════
        if (action === 'getusers') {
            const db = await getPool();
            const r = await db.request().query('SELECT [User Code],[User Name],[Role] FROM Users');
            context.res.body = JSON.stringify({ users: r.recordset });
            return;
        }

        context.res.body = JSON.stringify({
            help: 'Actions: login, customerDetail, getUsers, clearCache',
            params: 'code=X, customer=Y (for customerDetail), nocache=1'
        });

    } catch (err) {
        context.log.error('API Error:', err);
        if (err.code === 'ESOCKET' || err.code === 'ECONNCLOSED') { pool = null; }
        context.res.status = 500;
        context.res.body = JSON.stringify({ error: 'Database error', message: err.message });
    }
};
