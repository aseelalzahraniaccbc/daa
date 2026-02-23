// ══════════════════════════════════════════════════════════════
// SALES PORTAL v9 — Azure Function API (New Data Structure)
//
// Tables: Users, SalesmenData, SUPdata, BSMdata, MasterData
// Column names use spaces and special chars: [Salesman Code], [ACT-CY], etc.
//
// Deploy: Azure Function App → HTTP trigger → Anonymous auth
// Config: Add SQL_CONNECTION_STRING in Application Settings
// ══════════════════════════════════════════════════════════════

const sql = require('mssql');

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
    if (!pool) pool = await sql.connect(getConfig());
    return pool;
}

module.exports = async function (context, req) {
    context.res = {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    if (req.method === 'OPTIONS') { context.res.status = 204; context.res.body = ''; return; }

    try {
        const db = await getPool();
        const action = (req.query.action || '').toLowerCase();
        const code = (req.query.code || '').trim();
        let result = {};

        // ── LOGIN ──
        if (action === 'login') {
            if (!code) { context.res.body = JSON.stringify({ error: 'Code required' }); return; }

            const userRes = await db.request()
                .input('code', sql.NVarChar, code)
                .query('SELECT [User Code],[User Name],[Role] FROM Users WHERE [User Code] = @code');

            if (!userRes.recordset.length) {
                context.res.body = JSON.stringify({ error: 'User not found', code });
                return;
            }

            const user = userRes.recordset[0];
            result.user = user;
            const role = (user.Role || '').toLowerCase();

            if (role === 'salesman') {
                const sm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM SalesmenData WHERE [Salesman Code] = @code');
                result.salesmenData = sm.recordset;

                const md = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM MasterData WHERE [Salesman Code] = @code');
                result.masterData = md.recordset;
            }

            else if (role === 'supervisor') {
                const sm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM SalesmenData WHERE [Assigned SUP] = @code');
                result.salesmenData = sm.recordset;

                const smCodes = sm.recordset.map(r => r['Salesman Code']);
                if (smCodes.length) {
                    const placeholders = smCodes.map((_, i) => `@sm${i}`).join(',');
                    const mdReq = db.request();
                    smCodes.forEach((c, i) => mdReq.input(`sm${i}`, sql.NVarChar, String(c)));
                    const md = await mdReq.query(`SELECT * FROM MasterData WHERE [Salesman Code] IN (${placeholders})`);
                    result.masterData = md.recordset;
                } else {
                    result.masterData = [];
                }
            }

            else if (role === 'bsm') {
                const sup = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM SUPdata WHERE [AssignedBSM] = @code');
                result.supData = sup.recordset;

                const bsm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM BSMdata WHERE [BSM Code] = @code');
                result.bsmData = bsm.recordset;

                const spvCodes = sup.recordset.map(r => r['Supervisor Code']);
                if (spvCodes.length) {
                    const ph1 = spvCodes.map((_, i) => `@sp${i}`).join(',');
                    const smReq = db.request();
                    spvCodes.forEach((c, i) => smReq.input(`sp${i}`, sql.NVarChar, String(c)));
                    const sm = await smReq.query(`SELECT * FROM SalesmenData WHERE [Assigned SUP] IN (${ph1})`);
                    result.salesmenData = sm.recordset;

                    const smCodes = sm.recordset.map(r => r['Salesman Code']);
                    if (smCodes.length) {
                        const ph2 = smCodes.map((_, i) => `@sm${i}`).join(',');
                        const mdReq = db.request();
                        smCodes.forEach((c, i) => mdReq.input(`sm${i}`, sql.NVarChar, String(c)));
                        const md = await mdReq.query(`SELECT * FROM MasterData WHERE [Salesman Code] IN (${ph2})`);
                        result.masterData = md.recordset;
                    } else { result.masterData = []; }
                } else {
                    result.salesmenData = [];
                    result.masterData = [];
                }
            }

            else if (role === 'management') {
                const all = await db.request().query('SELECT [User Code],[User Name],[Role] FROM Users');
                result.allUsers = all.recordset;
            }

            context.res.body = JSON.stringify(result);
            return;
        }

        // ── GET USERS ──
        if (action === 'getusers') {
            const r = await db.request().query('SELECT [User Code],[User Name],[Role] FROM Users');
            result.users = r.recordset;
            context.res.body = JSON.stringify(result);
            return;
        }

        context.res.body = JSON.stringify({ help: 'Actions: login, getUsers', example: '?action=login&code=12345' });

    } catch (err) {
        context.log.error('API Error:', err);
        context.res.status = 500;
        context.res.body = JSON.stringify({ error: 'Database error', message: err.message });
    }
};
