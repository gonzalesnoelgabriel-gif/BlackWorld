import 'dotenv/config';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUser, verifyUser } from './sheets.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { success: false, message: 'Too many attempts; try again later.' }
});
app.use('/api/register', limiter);
app.use('/api/login', limiter);

app.post('/api/register', async (req, res) => {
  try {
    const user = await createUser(req.body?.username, req.body?.password);
    return res.status(201).json({ success: true, message: 'Demo account created.', email: user.email });
  } catch (error) {
    if (error.status === 400 || error.status === 409) return res.status(error.status).json({ success: false, message: error.message });
    console.error('REGISTRATION FAILED:', error.message);
    return res.status(503).json({ success: false, message: 'Registration temporarily unavailable. Check server and Apps Script execution logs.' });
  }
});
app.post('/api/login', async (req, res) => {
  try {
    const valid = await verifyUser(req.body?.username, req.body?.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid demo email or password.' });
    // This is a simulated authentication confirmation, NOT a persistent session.
    return res.json({ success: true, message: 'Demo sign-in successful.' });
  } catch (error) {
    console.error('LOGIN FAILED:', error.message);
    return res.status(503).json({ success: false, message: 'Sign-in temporarily unavailable. Check server logs.' });
  }
});
app.use('/api', (_req, res) => res.status(404).json({ success: false, message: 'Unknown API endpoint.' }));
const dir = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(dir, 'public')));
app.use((error, _req, res, _next) => {
  console.error('HTTP error:', error.message);
  if (error.status === 400 && error instanceof SyntaxError) return res.status(400).json({ success: false, message: 'Invalid JSON body.' });
  return res.status(500).json({ success: false, message: 'Server error.' });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Demo running at http://localhost:${port}`));
