import { google } from 'googleapis';
import { Reservation, Menu } from './types';

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

export async function addCalendarEvent(reservation: Reservation, menu: Menu) {
  const auth = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const startDateTime = `${reservation.reservation_date}T${reservation.start_time}`;
  const endDateTime = `${reservation.reservation_date}T${reservation.end_time}`;

  const event = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    requestBody: {
      summary: `【予約】${reservation.customer_name} - ${menu.name}`,
      description: [
        `顧客名: ${reservation.customer_name}`,
        `メール: ${reservation.customer_email || '未設定'}`,
        `電話: ${reservation.customer_phone || '未設定'}`,
        `メニュー: ${menu.name}`,
        `金額: ¥${menu.price.toLocaleString()}`,
        reservation.concerns ? `悩み・症状: ${reservation.concerns}` : '',
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: startDateTime,
        timeZone: 'Asia/Tokyo',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Asia/Tokyo',
      },
    },
  });

  return event.data.id;
}

export async function deleteCalendarEvent(eventId: string) {
  const auth = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  await calendar.events.delete({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    eventId,
  });
}
