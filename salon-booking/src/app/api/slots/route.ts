import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

// 営業時間: 10:00〜20:00（最終受付は施術時間分前）
const OPEN_HOUR = 10;
const CLOSE_HOUR = 20;
const SLOT_INTERVAL = 30; // 30分刻み

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const duration = parseInt(searchParams.get('duration') || '60');

  if (!date) {
    return NextResponse.json({ error: '日付が指定されていません' }, { status: 400 });
  }

  const supabase = createServerSupabase();

  // 指定日の既存予約を取得（キャンセル以外）
  const { data: existing } = await supabase
    .from('reservations')
    .select('start_time, end_time')
    .eq('reservation_date', date)
    .neq('status', 'キャンセル');

  const reservedSlots = (existing || []).map(r => ({
    start: r.start_time,
    end: r.end_time,
  }));

  // タイムスロットを生成
  const slots = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_INTERVAL) {
      const startTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const endMinutes = h * 60 + m + duration;
      const endH = Math.floor(endMinutes / 60);
      const endM = endMinutes % 60;
      const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

      // 営業時間外チェック
      if (endH > CLOSE_HOUR || (endH === CLOSE_HOUR && endM > 0)) continue;

      // ダブルブッキングチェック
      const isConflict = reservedSlots.some(r => {
        return startTime < r.end && endTime > r.start;
      });

      slots.push({
        time: startTime,
        available: !isConflict,
      });
    }
  }

  return NextResponse.json({ slots });
}
