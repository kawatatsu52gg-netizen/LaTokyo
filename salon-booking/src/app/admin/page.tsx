'use client';

import { useState, useEffect, useCallback } from 'react';
import { Reservation, ReservationStatus } from '@/lib/types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

const STATUS_OPTIONS: ReservationStatus[] = ['仮予約', '確定', '来店済', 'キャンセル'];
const STATUS_COLORS: Record<ReservationStatus, string> = {
  '仮予約': 'bg-yellow-100 text-yellow-800 border-yellow-300',
  '確定': 'bg-blue-100 text-blue-800 border-blue-300',
  '来店済': 'bg-green-100 text-green-800 border-green-300',
  'キャンセル': 'bg-gray-100 text-gray-500 border-gray-300',
};
const PAYMENT_METHODS = ['現金', 'クレジットカード', '電子マネー', 'QRコード決済', '銀行振込'];

export default function AdminPage() {
  const [auth, setAuth] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPayment, setEditPayment] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);

    const res = await fetch(`/api/admin/reservations?${params}`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (res.ok) {
      const data = await res.json();
      setReservations(data.reservations || []);
    }
    setLoading(false);
  }, [auth, filterStatus]);

  useEffect(() => {
    if (loggedIn) fetchReservations();
  }, [loggedIn, filterStatus, fetchReservations]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const encoded = btoa(`${username}:${password}`);
    setAuth(encoded);
    setLoggedIn(true);
  }

  async function updateStatus(id: string, status: ReservationStatus) {
    const res = await fetch('/api/admin/reservations', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ id, status }),
    });

    if (res.ok) {
      fetchReservations();
    } else {
      alert('ステータスの更新に失敗しました');
    }
  }

  async function saveDetails(id: string) {
    const res = await fetch('/api/admin/reservations', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        id,
        status: reservations.find(r => r.id === id)?.status,
        payment_method: editPayment,
        notes: editNotes,
      }),
    });

    if (res.ok) {
      setEditingId(null);
      fetchReservations();
    }
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="font-display text-xs tracking-[0.3em] text-[var(--muted)] uppercase mb-2">
              LaTokyo 代官山
            </div>
            <h1 className="font-display text-2xl font-light tracking-wider">
              Admin
            </h1>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="text" value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="ユーザー名"
              className="w-full p-3 border border-[var(--light-line)] bg-[var(--card-bg)] text-sm" />
            <input type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="パスワード"
              className="w-full p-3 border border-[var(--light-line)] bg-[var(--card-bg)] text-sm" />
            <button type="submit"
              className="w-full py-4 bg-[var(--dark)] text-[var(--cream)] text-sm tracking-widest">
              ログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--light-line)] px-6 py-4 flex items-center justify-between">
        <div>
          <span className="font-display text-xs tracking-[0.3em] text-[var(--muted)] uppercase">
            LaTokyo 代官山
          </span>
          <h1 className="font-display text-xl font-light tracking-wider">予約管理</h1>
        </div>
        <button onClick={() => fetchReservations()}
          className="px-4 py-2 text-xs border border-[var(--light-line)] text-[var(--muted)] hover:border-[var(--gold)] transition-colors">
          更新
        </button>
      </header>

      <div className="px-6 py-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilterStatus('')}
            className={`px-4 py-2 text-xs border transition-all
              ${!filterStatus ? 'border-[var(--dark)] bg-[var(--dark)] text-[var(--cream)]' : 'border-[var(--light-line)] text-[var(--muted)]'}`}
          >
            すべて ({reservations.length})
          </button>
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-4 py-2 text-xs border transition-all
                ${filterStatus === s ? 'border-[var(--dark)] bg-[var(--dark)] text-[var(--cream)]' : 'border-[var(--light-line)] text-[var(--muted)]'}`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-12 text-[var(--muted)]">読み込み中...</div>
        ) : reservations.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted)]">予約がありません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--light-line)]">
                  <th className="text-left py-3 px-3 text-xs text-[var(--muted)] font-normal tracking-wide">日時</th>
                  <th className="text-left py-3 px-3 text-xs text-[var(--muted)] font-normal tracking-wide">顧客名</th>
                  <th className="text-left py-3 px-3 text-xs text-[var(--muted)] font-normal tracking-wide">連絡先</th>
                  <th className="text-left py-3 px-3 text-xs text-[var(--muted)] font-normal tracking-wide">メニュー</th>
                  <th className="text-left py-3 px-3 text-xs text-[var(--muted)] font-normal tracking-wide">金額</th>
                  <th className="text-left py-3 px-3 text-xs text-[var(--muted)] font-normal tracking-wide">ステータス</th>
                  <th className="text-left py-3 px-3 text-xs text-[var(--muted)] font-normal tracking-wide">操作</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map(r => (
                  <tr key={r.id} className="border-b border-[var(--light-line)] hover:bg-[var(--card-bg)] transition-colors">
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div>{format(new Date(r.reservation_date), 'M/d（E）', { locale: ja })}</div>
                      <div className="text-xs text-[var(--muted)]">{r.start_time.slice(0, 5)}〜{r.end_time.slice(0, 5)}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div>{r.customer_name}</div>
                      {r.concerns && (
                        <div className="text-[10px] text-[var(--muted)] max-w-[200px] truncate" title={r.concerns}>
                          {r.concerns}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-[var(--muted)]">
                      {r.customer_email && <div>{r.customer_email}</div>}
                      {r.customer_phone && <div>{r.customer_phone}</div>}
                    </td>
                    <td className="py-3 px-3">{r.menu?.name || '-'}</td>
                    <td className="py-3 px-3 font-display text-[var(--gold)]">
                      ¥{r.menu?.price.toLocaleString() || '-'}
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={r.status}
                        onChange={(e) => updateStatus(r.id, e.target.value as ReservationStatus)}
                        className={`px-2 py-1 text-xs border rounded ${STATUS_COLORS[r.status]}`}
                      >
                        {STATUS_OPTIONS.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-3">
                      {editingId === r.id ? (
                        <div className="space-y-2 min-w-[200px]">
                          <select value={editPayment}
                            onChange={e => setEditPayment(e.target.value)}
                            className="w-full p-1 text-xs border border-[var(--light-line)] bg-[var(--card-bg)]">
                            <option value="">支払方法</option>
                            {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <input type="text" value={editNotes}
                            onChange={e => setEditNotes(e.target.value)}
                            placeholder="備考"
                            className="w-full p-1 text-xs border border-[var(--light-line)] bg-[var(--card-bg)]" />
                          <div className="flex gap-1">
                            <button onClick={() => saveDetails(r.id)}
                              className="px-2 py-1 text-[10px] bg-[var(--dark)] text-[var(--cream)]">保存</button>
                            <button onClick={() => setEditingId(null)}
                              className="px-2 py-1 text-[10px] border border-[var(--light-line)] text-[var(--muted)]">閉じる</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => {
                          setEditingId(r.id);
                          setEditPayment(r.payment_method || '');
                          setEditNotes(r.notes || '');
                        }}
                          className="px-3 py-1 text-[10px] border border-[var(--light-line)] text-[var(--muted)] hover:border-[var(--gold)] transition-colors">
                          詳細
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
