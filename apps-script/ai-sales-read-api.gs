/**
 * AI Sales Dashboard — READ-ONLY paginated JSON API (for review before deployment).
 *
 * Add this as a NEW file in the Apps Script project bound to the spreadsheet
 * "ai sale agent sale 26-27" (open that spreadsheet → Extensions → Apps Script
 * → "+" → Script). It does not replace or call any existing function.
 *
 * GET <exec URL>?sheet=<name>&limit=<1..1000>&offset=<0..>
 *
 * Success:
 *   { success: true, spreadsheetName, spreadsheetId, sheet, headers, rows,
 *     returnedRows, totalRows, offset, limit, hasMore, nextOffset, fetchedAt }
 * Failure:
 *   { success: false, error, allowedSheets? }
 *
 * Same response format as the deployment the dashboard already reads
 * (backend/src/modules/fms/fms-paged.client.ts):
 * - headers = the sheet's first row; rows = the following rows, as arrays;
 * - values come from getValues(): numbers stay numbers, dates become ISO UTC
 *   strings when serialised, empty cells are "", blank rows are included;
 * - totalRows = last row with content minus the header row;
 * - at most 1000 rows per request.
 *
 * READ-ONLY: only getName/getId/getSheetByName/getLastRow/getLastColumn/
 * getRange().getValues() are used. Nothing is written, cleared, formatted,
 * stored (no Properties/Cache service) or sent anywhere else.
 */

var AISALES_READ_ALLOWED_SHEETS = [
  'Data',
  'FMS',
  'Account_Process',
  'AP Form',
  'Customer_Database',
  'Form responses 2',
  'FMS Response'
];
var AISALES_READ_MAX_LIMIT = 1000;
var AISALES_READ_DEFAULT_LIMIT = 1000;

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var sheetName = params.sheet;
    if (!sheetName) return aisalesReadJson_({ success: false, error: 'Missing sheet parameter' });
    if (AISALES_READ_ALLOWED_SHEETS.indexOf(sheetName) === -1) {
      return aisalesReadJson_({ success: false, error: 'Sheet is not allowed', allowedSheets: AISALES_READ_ALLOWED_SHEETS });
    }

    var limit = aisalesReadInt_(params.limit, AISALES_READ_DEFAULT_LIMIT);
    var offset = aisalesReadInt_(params.offset, 0);
    if (limit < 1) limit = 1;
    if (limit > AISALES_READ_MAX_LIMIT) limit = AISALES_READ_MAX_LIMIT;
    if (offset < 0) offset = 0;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return aisalesReadJson_({ success: false, error: 'Sheet not found in this spreadsheet', allowedSheets: AISALES_READ_ALLOWED_SHEETS });
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var headers = lastRow >= 1 && lastCol >= 1 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var totalRows = Math.max(lastRow - 1, 0);

    var rows = [];
    var count = Math.min(limit, Math.max(totalRows - offset, 0));
    if (count > 0) rows = sheet.getRange(2 + offset, 1, count, lastCol).getValues();

    var hasMore = offset + rows.length < totalRows;
    return aisalesReadJson_({
      success: true,
      spreadsheetName: ss.getName(),
      spreadsheetId: ss.getId(),
      sheet: sheetName,
      headers: headers,
      rows: rows,
      returnedRows: rows.length,
      totalRows: totalRows,
      offset: offset,
      limit: limit,
      hasMore: hasMore,
      nextOffset: hasMore ? offset + rows.length : null,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    return aisalesReadJson_({ success: false, error: 'Read failed: ' + (err && err.message ? err.message : String(err)) });
  }
}

/** Run once from the editor (select it, click Run) to authorise and check — read-only, only logs. */
function aisalesReadSelfTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet: ' + ss.getName());
  AISALES_READ_ALLOWED_SHEETS.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    Logger.log(name + ': ' + (sheet ? Math.max(sheet.getLastRow() - 1, 0) + ' data rows' : 'NOT FOUND'));
  });
}

function aisalesReadInt_(value, fallback) {
  var n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

function aisalesReadJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
