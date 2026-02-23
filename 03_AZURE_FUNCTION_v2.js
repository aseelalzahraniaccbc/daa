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

        if (action === 'login') {
            if (!code) { context.res.body = JSON.stringify({ error: 'Code required' }); return; }

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

            if (role === 'salesman') {
                const sm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Salesman Code])) = LTRIM(RTRIM(@code))');
                result.salesmenData = sm.recordset;

                const md = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM MasterData WHERE LTRIM(RTRIM([Salesman Code])) = LTRIM(RTRIM(@code))');
                result.masterData = md.recordset;
            }

            else if (role === 'supervisor') {
                const sm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))');
                result.salesmenData = sm.recordset;

                const smCodes = sm.recordset.map(r => String(r['Salesman Code']).trim());
                if (smCodes.length) {
                    const placeholders = smCodes.map((_, i) => `@sm${i}`).join(',');
                    const mdReq = db.request();
                    smCodes.forEach((c, i) => mdReq.input(`sm${i}`, sql.NVarChar, c));
                    const md = await mdReq.query(`SELECT * FROM MasterData WHERE LTRIM(RTRIM([Salesman Code])) IN (${placeholders})`);
                    result.masterData = md.recordset;
                } else {
                    result.masterData = [];
                }
            }

            else if (role === 'bsm') {
                // Get supervisors assigned to this BSM
                const sup = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM SUPdata WHERE LTRIM(RTRIM([AssignedBSM])) = LTRIM(RTRIM(@code))');
                result.supData = sup.recordset;

                // Get BSM's own data
                const bsm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM BSMdata WHERE LTRIM(RTRIM([BSM Code])) = LTRIM(RTRIM(@code))');
                result.bsmData = bsm.recordset;

                // Get supervisor codes under this BSM
                const spvCodes = sup.recordset.map(r => String(r['Supervisor Code']).trim());

                // ALSO: Get salesmen directly assigned to BSM (Assigned SUP = BSM Code)
                // This handles BSMs who manage salesmen directly without supervisors
                const directSm = await db.request().input('code', sql.NVarChar, code)
                    .query('SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) = LTRIM(RTRIM(@code))');
                
                // Get salesmen under supervisors
                let smFromSup = [];
                if (spvCodes.length) {
                    const ph1 = spvCodes.map((_, i) => `@sp${i}`).join(',');
                    const smReq = db.request();
                    spvCodes.forEach((c, i) => smReq.input(`sp${i}`, sql.NVarChar, c));
                    const sm = await smReq.query(`SELECT * FROM SalesmenData WHERE LTRIM(RTRIM([Assigned SUP])) IN (${ph1})`);
                    smFromSup = sm.recordset;
                }

                // Combine: salesmen from supervisors + direct salesmen (deduplicate)
                const allSm = [...smFromSup, ...directSm.recordset];
                const smMap = {};
                allSm.forEach(r => { smMap[String(r['Salesman Code']).trim()] = r; });
                result.salesmenData = Object.values(smMap);

                // Get all salesman codes for MasterData
                const smCodes = Object.keys(smMap);
                
                // ALSO get MasterData where Supervisor Code = BSM Code (direct management)
                if (smCodes.length) {
                    const ph2 = smCodes.map((_, i) => `@sm${i}`).join(',');
                    const mdReq = db.request();
                    smCodes.forEach((c, i) => mdReq.input(`sm${i}`, sql.NVarChar, c));
                    // Get by salesman code OR by supervisor code = BSM code
                    mdReq.input('bsmCode', sql.NVarChar, code);
                    const md = await mdReq.query(`SELECT * FROM MasterData WHERE LTRIM(RTRIM([Salesman Code])) IN (${ph2}) OR LTRIM(RTRIM([Supervisor Code])) = LTRIM(RTRIM(@bsmCode))`);
                    result.masterData = md.recordset;
                } else {
                    // No salesmen from supervisors — get MasterData directly by Supervisor Code = BSM Code
                    const md = await db.request().input('code', sql.NVarChar, code)
                        .query('SELECT * FROM MasterData WHERE LTRIM(RTRIM([Supervisor Code])) = LTRIM(RTRIM(@code))');
                    result.masterData = md.recordset;
                }
            }

            else if (role === 'management') {
                const all = await db.request().query('SELECT [User Code],[User Name],[Role] FROM Users');
                result.allUsers = all.recordset;
            }

            context.res.body = JSON.stringify(result);
            return;
        }

        if (action === 'getusers') {
            const r = await db.request().query('SELECT [User Code],[User Name],[Role] FROM Users');
            result.users = r.recordset;
            context.res.body = JSON.stringify(result);
            return;
        }

        context.res.body = JSON.stringify({ help: 'Actions: login, getUsers' });

    } catch (err) {
        context.log.error('API Error:', err);
        context.res.status = 500;
        context.res.body = JSON.stringify({ error: 'Database error', message: err.message });
    }
};
