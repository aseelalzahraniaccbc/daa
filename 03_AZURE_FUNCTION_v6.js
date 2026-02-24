const sql = require('mssql');
function getConfig() {
    return process.env.SQL_CONNECTION_STRING || {
        server: process.env.SQL_SERVER, database: process.env.SQL_DATABASE,
        user: process.env.SQL_USER, password: process.env.SQL_PASSWORD,
        options: { encrypt: true, trustServerCertificate: false }
    };
}
let pool = null;
async function getPool() {
    if (pool) { try { await pool.request().query('SELECT 1'); return pool; } catch (e) { pool = null; } }
    pool = await sql.connect(getConfig()); return pool;
}
const cache = {}; const CACHE_TTL = 5 * 60 * 1000;
function cacheGet(k) { const e = cache[k]; if (!e) return null; if (Date.now() - e.time > CACHE_TTL) { delete cache[k]; return null; } return e.data; }
function cacheSet(k, d) { cache[k] = { data: d, time: Date.now() }; const ks = Object.keys(cache); if (ks.length > 200) { ks.sort((a, b) => cache[a].time - cache[b].time); for (let i = 0; i < ks.length - 100; i++) delete cache[ks[i]]; } }
function addSmParams(req, codes, pfx) { const ph = codes.map((_, i) => `@${pfx}${i}`).join(','); codes.forEach((c, i) => req.input(`${pfx}${i}`, sql.NVarChar, c)); return ph; }

module.exports = async function (context, req) {
    context.res = { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'public, max-age=300' } };
    if (req.method === 'OPTIONS') { context.res.status = 204; context.res.body = ''; return; }
    const t0 = Date.now();
    try {
        const action = (req.query.action || '').toLowerCase();
        const code = (req.query.code || '').trim();
        const noCache = req.query.nocache === '1';

        if (action === 'login') {
            if (!code) { context.res.body = JSON.stringify({ error: 'Code required' }); return; }
            const cacheKey = `v6_${code}`;
            if (!noCache) { const cached = cacheGet(cacheKey); if (cached) { context.log(`Cache HIT ${code} (${Date.now()-t0}ms)`); context.res.body = JSON.stringify(cached); return; } }
            const db = await getPool(); let result = {};
            const userRes = await db.request().input('code', sql.NVarChar, code).query('SELECT [User Code],[User Name],[Role] FROM Users WHERE LTRIM(RTRIM([User Code])) = LTRIM(RTRIM(@code))');
            if (!userRes.recordset.length) { context.res.body = JSON.stringify({ error: 'User not found', code }); return; }
            const user = userRes.recordset[0]; result.user = user;
            const role = (user.Role || '').toLowerCase().trim();

            if (role === 'salesman') {
                const [sm, cs] = await Promise.all([
                    db.request().input('code', sql.NVarChar, code).query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Salesman Code])) = LTRIM(RTRIM(@code))'),
                    db.request().input('code', sql.NVarChar, code).query('SELECT * FROM CustomerSummary WHERE LTRIM(RTRIM([Salesman Code])) = LTRIM(RTRIM(@code))')
                ]);
                result.salesmenData = sm.recordset; result.customerSummary = cs.recordset;
            }
            else if (role === 'supervisor') {
                const sm = await db.request().input('code', sql.NVarChar, code).query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))');
                result.salesmenData = sm.recordset;
                const smCodes = sm.recordset.map(r => String(r['Salesman Code']).trim());
                if (smCodes.length) { const csReq = db.request(); const ph = addSmParams(csReq, smCodes, 'sc'); const cs = await csReq.query(`SELECT * FROM CustomerSummary WHERE LTRIM(RTRIM([Salesman Code])) IN (${ph})`); result.customerSummary = cs.recordset; }
                else { result.customerSummary = []; }
            }
            else if (role === 'bsm') {
                const [sup, bsm, directSm] = await Promise.all([
                    db.request().input('code', sql.NVarChar, code).query('SELECT * FROM SUPdata WHERE LTRIM(RTRIM([AssignedBSM])) = LTRIM(RTRIM(@code))'),
                    db.request().input('code', sql.NVarChar, code).query('SELECT * FROM BSMdata WHERE LTRIM(RTRIM([BSM Code])) = LTRIM(RTRIM(@code))'),
                    db.request().input('code', sql.NVarChar, code).query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))')
                ]);
                result.supData = sup.recordset; result.bsmData = bsm.recordset;
                const spvCodes = sup.recordset.map(r => String(r['Supervisor Code']).trim());
                let smFromSup = [];
                if (spvCodes.length) { const smReq = db.request(); const ph = addSmParams(smReq, spvCodes, 'sp'); const sm = await smReq.query(`SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) IN (${ph})`); smFromSup = sm.recordset; }
                const smMap = {}; [...smFromSup, ...directSm.recordset].forEach(r => { smMap[String(r['Salesman Code']).trim()] = r; });
                result.salesmenData = Object.values(smMap);
                const smCodes = Object.keys(smMap);
                if (smCodes.length) { const csReq = db.request(); const ph = addSmParams(csReq, smCodes, 'sc'); csReq.input('bsmCode', sql.NVarChar, code); const cs = await csReq.query(`SELECT * FROM CustomerSummary WHERE LTRIM(RTRIM([Salesman Code])) IN (${ph}) OR LTRIM(RTRIM([Supervisor Code])) = LTRIM(RTRIM(@bsmCode))`); result.customerSummary = cs.recordset; }
                else { const cs = await db.request().input('code', sql.NVarChar, code).query('SELECT * FROM CustomerSummary WHERE LTRIM(RTRIM([Supervisor Code])) = LTRIM(RTRIM(@code))'); result.customerSummary = cs.recordset; }
            }
            else if (role === 'management') { const all = await db.request().query('SELECT [User Code],[User Name],[Role] FROM Users'); result.allUsers = all.recordset; }

            cacheSet(cacheKey, result);
            context.log(`Login ${code} (${role}): ${(result.customerSummary||[]).length} custs, ${Date.now()-t0}ms`);
            context.res.body = JSON.stringify(result); return;
        }

        if (action === 'customerdetail') {
            const customerCode = (req.query.customer || '').trim();
            if (!code || !customerCode) { context.res.body = JSON.stringify({ error: 'code and customer required' }); return; }
            const db = await getPool();
            const userRes = await db.request().input('code', sql.NVarChar, code).query('SELECT [Role] FROM Users WHERE LTRIM(RTRIM([User Code])) = LTRIM(RTRIM(@code))');
            if (!userRes.recordset.length) { context.res.body = JSON.stringify({ error: 'User not found' }); return; }
            const role = (userRes.recordset[0].Role || '').toLowerCase().trim();
            let scopeClause = ''; const detailReq = db.request();
            detailReq.input('custCode', sql.NVarChar, customerCode);

            if (role === 'salesman') { detailReq.input('smCode', sql.NVarChar, code); scopeClause = 'AND LTRIM(RTRIM(s.[Salesman Code])) = LTRIM(RTRIM(@smCode))'; }
            else if (role === 'supervisor') {
                const sm = await db.request().input('code', sql.NVarChar, code).query('SELECT [Salesman Code] FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))');
                const smCodes = sm.recordset.map(r => String(r['Salesman Code']).trim());
                if (smCodes.length) { const ph = addSmParams(detailReq, smCodes, 'sc'); scopeClause = `AND LTRIM(RTRIM(s.[Salesman Code])) IN (${ph})`; }
                else { scopeClause = 'AND 1=0'; }
            }
            else if (role === 'bsm') {
                const sup = await db.request().input('code', sql.NVarChar, code).query('SELECT [Supervisor Code] FROM SUPdata WHERE LTRIM(RTRIM([AssignedBSM])) = LTRIM(RTRIM(@code))');
                const spvCodes = sup.recordset.map(r => String(r['Supervisor Code']).trim());
                let smCodes = [];
                if (spvCodes.length) { const smReq = db.request(); const ph = addSmParams(smReq, spvCodes, 'sp'); const sm = await smReq.query(`SELECT [Salesman Code] FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) IN (${ph})`); smCodes = sm.recordset.map(r => String(r['Salesman Code']).trim()); }
                const dSm = await db.request().input('code', sql.NVarChar, code).query('SELECT [Salesman Code] FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))');
                dSm.recordset.forEach(r => { const sc = String(r['Salesman Code']).trim(); if (!smCodes.includes(sc)) smCodes.push(sc); });
                if (smCodes.length) { const ph = addSmParams(detailReq, smCodes, 'sc'); detailReq.input('bsmCode', sql.NVarChar, code); scopeClause = `AND (LTRIM(RTRIM(s.[Salesman Code])) IN (${ph}) OR LTRIM(RTRIM(s.[Supervisor Code])) = LTRIM(RTRIM(@bsmCode)))`; }
                else { detailReq.input('bsmCode', sql.NVarChar, code); scopeClause = 'AND LTRIM(RTRIM(s.[Supervisor Code])) = LTRIM(RTRIM(@bsmCode))'; }
            }

            const detail = await detailReq.query(`
                SELECT s.[Customer Code], c.[Customer], c.[Sector], c.[Class], c.[Region], c.[Branch],
                    s.[Salesman Code], s.[Supervisor Code], s.[Route Code],
                    p.[Brand], p.[Product Group], p.[Sub Brand], p.[Product],
                    s.[DayDate] AS [Date], s.[L3S], s.[L6S],
                    s.[ACH CY (P)], s.[ACH LY (P)], s.[ACT-CY], s.[ACT-LY]
                FROM Sales s
                LEFT JOIN Customers c ON LTRIM(RTRIM(s.[Customer Code])) = LTRIM(RTRIM(c.[Customer Code]))
                LEFT JOIN Products p ON LTRIM(RTRIM(s.[PK_ProductID])) = LTRIM(RTRIM(p.[PK_ProductID]))
                WHERE LTRIM(RTRIM(s.[Customer Code])) = LTRIM(RTRIM(@custCode)) ${scopeClause}
                ORDER BY s.[DayDate], p.[Brand], p.[Product]
            `);
            context.log(`Detail ${customerCode}: ${detail.recordset.length} rows, ${Date.now()-t0}ms`);
            context.res.body = JSON.stringify({ rows: detail.recordset, total: detail.recordset.length }); return;
        }

        if (action === 'clearcache') { Object.keys(cache).forEach(k => delete cache[k]); context.res.body = JSON.stringify({ success: true, message: 'Cache cleared' }); return; }
        if (action === 'getusers') { const db = await getPool(); const r = await db.request().query('SELECT [User Code],[User Name],[Role] FROM Users'); context.res.body = JSON.stringify({ users: r.recordset }); return; }
        context.res.body = JSON.stringify({ help: 'Actions: login, customerDetail, getUsers, clearCache' });
    } catch (err) {
        context.log.error('API Error:', err);
        if (err.code === 'ESOCKET' || err.code === 'ECONNCLOSED') { pool = null; }
        context.res.status = 500;
        context.res.body = JSON.stringify({ error: 'Database error', message: err.message });
    }
};
