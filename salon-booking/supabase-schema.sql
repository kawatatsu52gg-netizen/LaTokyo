-- ============================================
-- LaTokyo 整体サロン予約管理システム
-- Supabase Schema
-- ============================================

-- メニューテーブル
CREATE TABLE menus (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 予約テーブル
CREATE TABLE reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  menu_id UUID NOT NULL REFERENCES menus(id),
  reservation_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  concerns TEXT,
  status TEXT NOT NULL DEFAULT '仮予約'
    CHECK (status IN ('仮予約', '確定', '来店済', 'キャンセル')),
  payment_method TEXT,
  notes TEXT,
  google_calendar_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ダブルブッキング防止のためのインデックス
CREATE INDEX idx_reservations_date_time ON reservations (reservation_date, start_time, end_time)
  WHERE status NOT IN ('キャンセル');

-- ダブルブッキング防止の関数
CREATE OR REPLACE FUNCTION check_double_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE id != NEW.id
      AND reservation_date = NEW.reservation_date
      AND status NOT IN ('キャンセル')
      AND (
        (NEW.start_time >= start_time AND NEW.start_time < end_time)
        OR (NEW.end_time > start_time AND NEW.end_time <= end_time)
        OR (NEW.start_time <= start_time AND NEW.end_time >= end_time)
      )
  ) THEN
    RAISE EXCEPTION 'この時間帯は既に予約が入っています';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_double_booking
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION check_double_booking();

-- updated_at自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 初期メニューデータ
INSERT INTO menus (name, description, duration_minutes, price, sort_order) VALUES
  ('整体コース（60分）', '全身の歪みを整える基本コース', 60, 8000, 1),
  ('整体コース（90分）', 'じっくりと全身を整えるロングコース', 90, 11000, 2),
  ('骨盤矯正コース', '骨盤の歪みに特化した施術', 60, 9000, 3),
  ('猫背・姿勢改善コース', '姿勢の改善に焦点を当てた施術', 60, 9000, 4),
  ('小顔矯正コース', 'フェイスラインを整える施術', 45, 7000, 5),
  ('初回限定お試しコース', '初めての方向けのお試し施術', 40, 5000, 6);

-- RLS (Row Level Security) ポリシー
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- メニューは誰でも閲覧可能
CREATE POLICY "メニューは誰でも閲覧可能" ON menus
  FOR SELECT USING (true);

-- 予約は誰でも作成可能（外部予約ページ用）
CREATE POLICY "予約は誰でも作成可能" ON reservations
  FOR INSERT WITH CHECK (true);

-- 予約の閲覧・更新は認証ユーザーのみ（管理画面用）
CREATE POLICY "予約の閲覧は認証ユーザーのみ" ON reservations
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "予約の更新は認証ユーザーのみ" ON reservations
  FOR UPDATE USING (auth.role() = 'authenticated');
