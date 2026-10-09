import { google } from 'googleapis';
import bcrypt from 'bcrypt';
import 'dotenv/config';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({
  version: 'v4',
  auth,
});

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Users';

// Create a user
export async function createUser(username, password) {
  const hashedPassword = await bcrypt.hash(password, 10);

  // Get existing users
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:B`,
  });

  const rows = result.data.values || [];

  // Check duplicate username
  const exists = rows.some(
    (row, index) =>
      index > 0 && row[0]?.toLowerCase() === username.toLowerCase()
  );

  if (exists) {
    const error = new Error('Username already exists');
    error.code = '23505';
    throw error;
  }

  // Add user
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:B`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[username, hashedPassword]],
    },
  });
}

// Verify user
export async function verifyUser(username, password) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:B`,
  });

  const rows = result.data.values || [];

  const user = rows.find(
    (row, index) =>
      index > 0 &&
      row[0]?.toLowerCase() === username.toLowerCase()
  );

  if (!user) {
    return false;
  }

  return await bcrypt.compare(password, user[1]);
}