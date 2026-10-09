import bcrypt from 'bcrypt';

const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
const secret = process.env.APPS_SCRIPT_SHARED_SECRET;
if (!scriptUrl || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(scriptUrl)) {
  throw new Error('Invalid GOOGLE_APPS_SCRIPT_URL in .env');
}
if (!secret || secret.length < 32 || secret.includes('PASTE_') || secret.includes('YOUR_')) {
  throw new Error('Configure a NEW random APPS_SCRIPT_SHARED_SECRET in .env and Apps Script properties');
}

const normalizeEmail = value => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9][^\s@]*@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};
const clientError = (message, status = 400) => Object.assign(new Error(message), { status });

async function callScript(action, payload) {
  let response;
  try {
    response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, action, secret }),
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new Error(`Cannot contact Apps Script: ${error.name === 'TimeoutError' ? 'request timed out' : error.message}`);
  }
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); }
  catch { throw new Error(`Apps Script sent non-JSON (HTTP ${response.status}, content-type: ${response.headers.get('content-type') || 'unknown'}). Check Web App access/version.`); }
  if (!response.ok) throw new Error(`Apps Script HTTP ${response.status}`);
  if (!result || typeof result.success !== 'boolean') throw new Error('Invalid Apps Script JSON response');
  if (!result.success) {
    if (result.code === 'DUPLICATE') throw clientError('That demo email is already registered.', 409);
    if (result.code === 'BAD_REQUEST') throw clientError(result.error || 'Invalid request');
    console.error('Apps Script rejected operation:', { action, code: result.code, stage: result.stage, error: result.error });
    throw new Error(`Apps Script: ${result.error || 'Unknown error'}${result.stage ? ` [stage: ${result.stage}]` : ''}`);
  }
  return result;
}

export async function createUser(username, password) {
  const email = normalizeEmail(username);
  if (!email) throw clientError('Enter a valid demo email address.');
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw clientError('Use a unique demo password of 12+ characters, at most 72 UTF-8 bytes.');
  }
  const hash = await bcrypt.hash(password, 12);
  await callScript('register', { email, hash });
  return { email };
}

export async function verifyUser(username, password) {
  const email = normalizeEmail(username);
  if (!email || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) return false;
  const result = await callScript('getHash', { email });
  if (typeof result.hash !== 'string' || !/^\$2[aby]\$\d{2}\$/.test(result.hash)) return false;
  return bcrypt.compare(password, result.hash);
}
