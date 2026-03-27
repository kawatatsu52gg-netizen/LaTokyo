import { google } from 'googleapis';
import { Reservation, Menu } from './types';

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function appendToSheet(reservation: Reservation, menu: Menu) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // カラム: 日付 | 顧客名 | メニュー | 金額 | ステータス | 支払方法 | 備考
  const values = [
    [
      reservation.reservation_date,
      reservation.customer_name,
      menu.name,
      menu.price,
      reservation.status,
      reservation.payment_method || '',
      reservation.concerns || '',
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    range: 'Sheet1!A:G',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}
