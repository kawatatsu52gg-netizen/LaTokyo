import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    customer_name,
    customer_email,
    customer_phone,
    menu_id,
    reservation_date,
    start_time,
    concerns,
  } = body;

  // バリデーション
  if (!customer_name || !menu_id || !reservation_date || !start_time) {
    return NextResponse.json({ error: '必須項目が入力されていません' }, { status: 400 });
  }
  if (!customer_email && !customer_phone) {
    return NextResponse.json({ error: 'メールアドレスまたは電話番号を入力してください' }, { status: 400 });
  }

  const supabase = createServerSupabase();

  // メニュー情報を取得
  const { data: menu } = await supabase
    .from('menus')
    .select('*')
    .eq('id', menu_id)
    .single();

  if (!menu) {
    return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 400 });
  }

  // 終了時間を計算
  const [startH, startM] = start_time.split(':').map(Number);
  const endMinutes = startH * 60 + startM + menu.duration_minutes;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  const end_time = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;

  // 予約を作成（ダブルブッキングはDBトリガーでも防止）
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      customer_name,
      customer_email: customer_email || null,
      customer_phone: customer_phone || null,
      menu_id,
      reservation_date,
      start_time: `${start_time}:00`,
      end_time,
      concerns: concerns || null,
      status: '仮予約',
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes('既に予約')) {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています。別の時間をお選びください。' }, { status: 409 });
    }
    return NextResponse.json({ error: '予約の作成に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ reservation: data }, { status: 201 });
}
