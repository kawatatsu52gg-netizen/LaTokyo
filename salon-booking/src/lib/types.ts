export type ReservationStatus = '仮予約' | '確定' | '来店済' | 'キャンセル';

export interface Menu {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  is_active: boolean;
  sort_order: number;
}

export interface Reservation {
  id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  menu_id: string;
  reservation_date: string;
  start_time: string;
  end_time: string;
  concerns: string | null;
  status: ReservationStatus;
  payment_method: string | null;
  notes: string | null;
  google_calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
  // JOINで取得
  menu?: Menu;
}

export interface ReservationFormData {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  menu_id: string;
  reservation_date: string;
  start_time: string;
  concerns: string;
}

export interface TimeSlot {
  time: string;
  available: boolean;
}
