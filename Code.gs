/**
 * BlockWorld independent demo: Google Apps Script storage.
 * Required Script Property (Project settings -> Script properties):
 *   APPS_SCRIPT_SHARED_SECRET = same random 64-character secret as the backend .env
 * The spreadsheet ID is a non-secret and can be set below, or overridden with a
 * SPREADSHEET_ID Script Property.
 * Deploy as Web App: execute as Me; access Anyone (the POST API checks secret).
 * Never put secrets in source code or HTML.
 */
const USERS_TAB = 'Users';
const DEFAULT_SPREADSHEET_ID = '1u5dzc1XKfLkUCeoon_HJzZzGp7Cca9P8LKasDqvATh8';

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

function settings_() {
  const props = PropertiesService.getScriptProperties();
  const id = (props.getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID).trim();
  const secret = (props.getProperty('APPS_SCRIPT_SHARED_SECRET') || '').trim();
  if (!id) throw new Error('Missing SPREADSHEET_ID Script Property');
  if (secret.length < 32) throw new Error('Missing or short APPS_SCRIPT_SHARED_SECRET Script Property');
  return { id, secret };
}

function usersSheet_() {
  const { id } = settings_();
  // The deploying account needs edit permission on this spreadsheet.
  const book = SpreadsheetApp.openById(id);
  let sheet = book.getSheetByName(USERS_TAB);
  if (!sheet) {
    sheet = book.insertSheet(USERS_TAB);
  }

  // Add metadata columns without replacing any existing headers or user rows.
  const headers = ['username', 'password_hash', 'created_at_utc', 'last_login_at_utc'];
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  let headersChanged = false;
  headers.forEach((header, index) => {
    if (!currentHeaders[index]) {
      currentHeaders[index] = header;
      headersChanged = true;
    }
  });
  if (headersChanged) sheet.getRange(1, 1, 1, headers.length).setValues([currentHeaders]);
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  return sheet;
}

function email_(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  // Restrict initial character to protect Sheet cells from formula interpretation.
  return /^[a-z0-9][^\s@]*@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email : null;
}

function doGet() {
  return json_({ success: true, message: 'BlockWorld demo Apps Script is responding. POST needs backend authorization.' });
}

function doPost(e) {
  let stage = 'parse';
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 8192) return json_({ success: false, code: 'BAD_REQUEST', error: 'Invalid request body' });
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json_({ success: false, code: 'BAD_REQUEST', error: 'Invalid request' });

    stage = 'configuration';
    const config = settings_();
    stage = 'authorization';
    if (typeof body.secret !== 'string' || body.secret !== config.secret) {
      return json_({ success: false, code: 'UNAUTHORIZED', error: 'Unauthorized' });
    }
    stage = 'validation';
    const address = email_(body.email);
    if (!address) return json_({ success: false, code: 'BAD_REQUEST', error: 'Invalid email address' });

    if (body.action === 'register') {
      const hash = body.hash;
      if (typeof hash !== 'string' || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) {
        return json_({ success: false, code: 'BAD_REQUEST', error: 'Invalid password hash' });
      }
      stage = 'register';
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) return json_({ success: false, code: 'BUSY', error: 'Please retry shortly' });
      try {
        const sheet = usersSheet_();
        const last = sheet.getLastRow();
        const rows = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues() : [];
        if (rows.some(row => String(row[0]).trim().toLowerCase() === address)) {
          return json_({ success: false, code: 'DUPLICATE', error: 'Email already registered' });
        }
        // Use explicitly formatted text cells, not formula-interpreted USER_ENTERED data.
        const dest = sheet.getRange(last + 1, 1, 1, 4);
        dest.setNumberFormat('@');
        dest.setValues([[address, hash, new Date().toISOString(), '']]);
        SpreadsheetApp.flush();
        return json_({ success: true, message: 'Demo account created' });
      } finally {
        lock.releaseLock();
      }
    }

    if (body.action === 'getHash') {
      stage = 'getHash';
      const sheet = usersSheet_();
      const last = sheet.getLastRow();
      if (last < 2) return json_({ success: true, hash: null });
      const rows = sheet.getRange(2, 1, last - 1, 2).getValues();
      const row = rows.find(item => String(item[0]).trim().toLowerCase() === address);
      return json_({ success: true, hash: row ? String(row[1]) : null });
    }

    if (body.action === 'touchLogin') {
      stage = 'touchLogin';
      const sheet = usersSheet_();
      const last = sheet.getLastRow();
      if (last < 2) return json_({ success: false, code: 'NOT_FOUND', error: 'Account not found' });
      const rows = sheet.getRange(2, 1, last - 1, 1).getValues();
      const index = rows.findIndex(row => String(row[0]).trim().toLowerCase() === address);
      if (index < 0) return json_({ success: false, code: 'NOT_FOUND', error: 'Account not found' });
      const loginCell = sheet.getRange(index + 2, 4);
      loginCell.setNumberFormat('@');
      loginCell.setValue(new Date().toISOString());
      SpreadsheetApp.flush();
      return json_({ success: true, message: 'Sign-in time recorded' });
    }

    return json_({ success: false, code: 'BAD_REQUEST', error: 'Unknown action' });
  } catch (error) {
    // In Apps Script Executions you will see the real error and the stage.
    console.error('BlockWorld Apps Script failure:', stage, error && error.stack ? error.stack : String(error));
    const safeError = stage === 'configuration'
      ? String(error && error.message ? error.message : 'Invalid Apps Script configuration')
      : 'Apps Script execution failed';
    return json_({ success: false, code: 'SCRIPT_FAILURE', error: safeError, stage });
  }
}

/** Run manually in the Apps Script editor. Does not reveal secrets or users. */
function diagnoseGoogleSheets() {
  const config = settings_();
  console.log('SPREADSHEET_ID configured:', !!config.id);
  console.log('APPS_SCRIPT_SHARED_SECRET configured:', true);
  const book = SpreadsheetApp.openById(config.id);
  console.log('Spreadsheet access OK:', book.getName());
  const sheet = usersSheet_();
  console.log('Users tab accessible:', sheet.getName(), 'rows:', sheet.getLastRow());
  // Test write without touching a user's row, then restore its original value.
  const cell = sheet.getRange('Z1');
  const old = cell.getValue();
  try {
    cell.setValue('diagnostic');
    SpreadsheetApp.flush();
    console.log('Write access OK');
  } finally {
    cell.setValue(old);
    SpreadsheetApp.flush();
  }
  console.log('DIAGNOSTIC SUCCESS');
}
