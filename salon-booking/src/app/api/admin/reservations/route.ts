import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { addCalendarEvent } from '@/lib/google-calendar';
import { appendToSheet } from '@/lib/google-sheets';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  return user === process.env.ADMIN_USERNAME && pass === process.env.ADMIN_PASSWORD;
}

// 予約一覧取得
export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const supabase = createServerSupabase();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  let query = supabase
    .from('reservations')
    .select('*, menu:menus(*)')
    .order('reservation_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (status) query = query.eq('status', status);
  if (from) query = query.gte('reservation_date', from);
  if (to) query = query.lte('reservation_date', to);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ reservations: data });
}

// ステータス更新
export async function PATCH(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const { id, status, payment_method, notes } = body;

  if (!id || !status) {
    return NextResponse.json({ error: 'IDとステータスは必須です' }, { status: 400 });
  }

  const supabase = createServerSupabase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = { status };
  if (payment_method !== undefined) updateData.payment_method = payment_method;
  if (notes !== undefined) updateData.notes = notes;

  const { data, error } = await supabase
    .from('reservations')
    .update(updateData)
    .eq('id', id)
    .select('*, menu:menus(*)')
    .single();

  if (error) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }

  // 確定時: Googleカレンダー＆スプレッドシートに登録
  if (status === '確定' && data.menu) {
    try {
      const eventId = await addCalendarEvent(data, data.menu);
      if (eventId) {
        await supabase
          .from('reservations')
          .update({ google_calendar_event_id: eventId })
          .eq('id', id);
      }
    } catch (e) {
      console.error('Google Calendar連携エラー:', e);
    }

    try {
      await appendToSheet(data, data.menu);
    } catch (e) {
      console.error('Google Sheets連携エラー:', e);
    }
  }

  return NextResponse.json({ reservation: data });
}
