// ══════════════════════════════════════════════════════════════
// SALES PORTAL — Google Apps Script API (v9 — New Data Structure)
//
// Google Sheet tabs must be named exactly:
//   Users, SalesmenData, SUPdata, BSMdata, MasterData
//
// HOW TO INSTALL:
// 1. Open your Google Sheet
// 2. Extensions → Apps Script
// 3. Delete existing code, paste this entire script
// 4. Save (name: "Portal API")
// 5. Deploy → New deployment → Web app
// 6. Execute as: Me, Who has access: Anyone
// 7. Deploy → Copy URL → Paste as APPS_SCRIPT_URL in HTML files
// ══════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    var action = (e.parameter.action || '').toLowerCase();
    var code = e.parameter.code || '';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result = {};

    // ── ACTION: login ──
    if (action === 'login') {
      var usersSheet = ss.getSheetByName('Users');
      var users = sheetToArray(usersSheet);
      var user = null;
      for (var i = 0; i < users.length; i++) {
        if (String(users[i]['User Code']) === String(code)) {
          user = users[i];
          break;
        }
      }
      if (!user) {
        return jsonResponse({ error: 'User not found', code: code });
      }
      result.user = user;
      var userRole = (user.Role || '').toLowerCase();

      if (userRole === 'salesman') {
        // Salesman's own performance
        var smSheet = ss.getSheetByName('SalesmenData');
        var smData = sheetToArray(smSheet);
        result.salesmenData = smData.filter(function(r) {
          return String(r['Salesman Code']) === String(code);
        });
        // Salesman's customers from MasterData
        var mdSheet = ss.getSheetByName('MasterData');
        var mdData = sheetToArray(mdSheet);
        result.masterData = mdData.filter(function(r) {
          return String(r['Salesman Code']) === String(code);
        });
      }

      else if (userRole === 'supervisor') {
        // Salesmen assigned to this supervisor
        var smSheet = ss.getSheetByName('SalesmenData');
        var smData = sheetToArray(smSheet);
        result.salesmenData = smData.filter(function(r) {
          return String(r['Assigned SUP']) === String(code);
        });
        // Salesman codes under this supervisor
        var smCodes = result.salesmenData.map(function(r) { return String(r['Salesman Code']); });
        // MasterData for those salesmen
        var mdSheet = ss.getSheetByName('MasterData');
        var mdData = sheetToArray(mdSheet);
        result.masterData = mdData.filter(function(r) {
          return smCodes.indexOf(String(r['Salesman Code'])) !== -1;
        });
      }

      else if (userRole === 'bsm') {
        // Supervisors under this BSM
        var supSheet = ss.getSheetByName('SUPdata');
        var supData = sheetToArray(supSheet);
        result.supData = supData.filter(function(r) {
          return String(r['AssignedBSM']) === String(code);
        });
        // BSM's own data
        var bsmSheet = ss.getSheetByName('BSMdata');
        var bsmData = sheetToArray(bsmSheet);
        result.bsmData = bsmData.filter(function(r) {
          return String(r['BSM Code']) === String(code);
        });
        // Supervisor codes under this BSM
        var spvCodes = result.supData.map(function(r) { return String(r['Supervisor Code']); });
        // All salesmen under those supervisors
        var smSheet = ss.getSheetByName('SalesmenData');
        var smData = sheetToArray(smSheet);
        result.salesmenData = smData.filter(function(r) {
          return spvCodes.indexOf(String(r['Assigned SUP'])) !== -1;
        });
        // Salesman codes
        var smCodes = result.salesmenData.map(function(r) { return String(r['Salesman Code']); });
        // MasterData for those salesmen
        var mdSheet = ss.getSheetByName('MasterData');
        var mdData = sheetToArray(mdSheet);
        result.masterData = mdData.filter(function(r) {
          return smCodes.indexOf(String(r['Salesman Code'])) !== -1;
        });
      }

      else if (userRole === 'management') {
        result.allUsers = users;
      }

      return jsonResponse(result);
    }

    // ── ACTION: getUsers ──
    if (action === 'getusers') {
      var usersSheet = ss.getSheetByName('Users');
      result.users = sheetToArray(usersSheet);
      return jsonResponse(result);
    }

    return jsonResponse({
      help: 'Actions: login, getUsers',
      example: '?action=login&code=75241'
    });

  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

function sheetToArray(sheet) {
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    var hasData = false;
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      obj[String(headers[j]).trim()] = val;
      if (val !== '' && val !== null && val !== undefined) hasData = true;
    }
    if (hasData) rows.push(obj);
  }
  return rows;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
