'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Menu, ReservationFormData, TimeSlot } from '@/lib/types';
import { format, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';

const STEPS = ['お悩み', 'メニュー', '日時', 'お客様情報', '確認'];

export default function BookingPage() {
  const [step, setStep] = useState(0);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [selectedConcerns, setSelectedConcerns] = useState<string[]>([]);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<ReservationFormData>({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    menu_id: '',
    reservation_date: '',
    start_time: '',
    concerns: '',
  });

  const concerns = [
    { icon: '🦴', title: '肩こり・首こり', desc: 'デスクワークや姿勢の悪さからくる症状' },
    { icon: '🔄', title: '腰痛・骨盤の歪み', desc: '慢性的な腰の痛みや骨盤の不調' },
    { icon: '🧘', title: '姿勢改善・猫背', desc: '姿勢を正して美しいボディラインに' },
    { icon: '😴', title: '疲労・倦怠感', desc: '全身の疲れやだるさの解消' },
    { icon: '✨', title: '小顔・フェイスライン', desc: 'お顔の歪みやむくみのケア' },
    { icon: '🏃', title: 'スポーツケア', desc: '運動後のメンテナンスや怪我の予防' },
  ];

  useEffect(() => {
    supabase.from('menus').select('*').eq('is_active', true).order('sort_order')
      .then(({ data }) => data && setMenus(data));
  }, []);

  const selectedMenu = menus.find(m => m.id === form.menu_id);

  const dateOptions = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(new Date(), i + 1);
    return {
      value: format(d, 'yyyy-MM-dd'),
      label: format(d, 'M月d日（E）', { locale: ja }),
    };
  });

  async function fetchAvailableSlots(date: string) {
    if (!selectedMenu) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/slots?date=${date}&duration=${selectedMenu.duration_minutes}`);
      const data = await res.json();
      setAvailableSlots(data.slots || []);
    } catch {
      setAvailableSlots([]);
    }
    setLoading(false);
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          concerns: [
            ...selectedConcerns,
            form.concerns ? `その他: ${form.concerns}` : '',
          ].filter(Boolean).join('、'),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || '予約に失敗しました');
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch {
      alert('予約に失敗しました。もう一度お試しください。');
    }
    setLoading(false);
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="font-display text-sm tracking-[0.3em] text-[var(--muted)] uppercase mb-2">
            LaTokyo 代官山
          </div>
          <h1 className="font-display text-3xl font-light tracking-wider mb-6">
            Thank You
          </h1>
          <div className="bg-[var(--card-bg)] border border-[var(--light-line)] p-8 mb-6">
            <p className="text-sm leading-relaxed text-[var(--muted)] tracking-wide">
              ご予約リクエストを承りました。<br />
              内容を確認の上、担当者より<br />
              ご連絡させていただきます。
            </p>
          </div>
          <p className="text-xs text-[var(--muted)]">
            ※ 仮予約の状態です。確定のご連絡をお待ちください。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="text-center py-10 border-b border-[var(--light-line)]">
        <div className="font-display text-xs tracking-[0.3em] text-[var(--muted)] uppercase mb-2">
          LaTokyo 代官山
        </div>
        <h1 className="font-display text-2xl font-light tracking-wider">
          Reservation
        </h1>
      </header>

      {/* Steps */}
      <div className="flex items-center justify-center gap-0 py-6 border-b border-[var(--light-line)] overflow-x-auto px-4">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center">
            {i > 0 && <div className="w-8 h-px bg-[var(--light-line)] mb-4" />}
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border transition-all
                ${i < step ? 'bg-[var(--gold)] border-[var(--gold)] text-white' :
                  i === step ? 'bg-[var(--dark)] border-[var(--dark)] text-[var(--cream)]' :
                  'bg-[var(--cream)] border-[var(--light-line)] text-[var(--muted)]'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-[10px] tracking-wide whitespace-nowrap
                ${i === step ? 'text-[var(--dark)]' : 'text-[var(--muted)]'}`}>
                {s}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto px-6 py-10">

        {/* Step 0: お悩み選択 */}
        {step === 0 && (
          <div>
            <h2 className="font-display text-xl font-light tracking-wide mb-1">Your Concerns</h2>
            <p className="text-xs text-[var(--muted)] tracking-wide mb-8 leading-relaxed">
              お悩みをお選びください（複数選択可）
            </p>
            <div className="flex flex-col gap-2.5">
              {concerns.map(c => {
                const selected = selectedConcerns.includes(c.title);
                return (
                  <button
                    key={c.title}
                    onClick={() => setSelectedConcerns(prev =>
                      selected ? prev.filter(x => x !== c.title) : [...prev, c.title]
                    )}
                    className={`flex items-center gap-4 p-4 border text-left transition-all
                      ${selected ? 'border-[var(--dark)] bg-white' : 'border-[var(--light-line)] bg-[var(--card-bg)] hover:border-[var(--gold)]'}`}
                  >
                    <span className="text-xl w-9 text-center flex-shrink-0">{c.icon}</span>
                    <div className="flex-1">
                      <div className="text-sm tracking-wide">{c.title}</div>
                      <div className="text-[11px] text-[var(--muted)]">{c.desc}</div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] flex-shrink-0 transition-all
                      ${selected ? 'bg-[var(--dark)] border-[var(--dark)] text-white' : 'border-[var(--light-line)]'}`}>
                      {selected && '✓'}
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setStep(1)}
              disabled={selectedConcerns.length === 0}
              className="w-full mt-8 py-4 bg-[var(--dark)] text-[var(--cream)] text-sm tracking-widest disabled:opacity-30 transition-opacity"
            >
              次へ進む
            </button>
          </div>
        )}

        {/* Step 1: メニュー選択 */}
        {step === 1 && (
          <div>
            <h2 className="font-display text-xl font-light tracking-wide mb-1">Select Menu</h2>
            <p className="text-xs text-[var(--muted)] tracking-wide mb-8 leading-relaxed">
              ご希望のメニューをお選びください
            </p>
            <div className="flex flex-col gap-2.5">
              {menus.map(menu => (
                <button
                  key={menu.id}
                  onClick={() => setForm(f => ({ ...f, menu_id: menu.id }))}
                  className={`p-4 border text-left transition-all
                    ${form.menu_id === menu.id ? 'border-[var(--dark)] bg-white' : 'border-[var(--light-line)] bg-[var(--card-bg)] hover:border-[var(--gold)]'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="text-sm tracking-wide">{menu.name}</div>
                    <div className="font-display text-lg font-light text-[var(--gold)]">
                      ¥{menu.price.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {menu.description} ・ {menu.duration_minutes}分
                  </div>
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setStep(0)}
                className="flex-1 py-4 border border-[var(--light-line)] text-sm tracking-widest text-[var(--muted)]">
                戻る
              </button>
              <button onClick={() => setStep(2)} disabled={!form.menu_id}
                className="flex-1 py-4 bg-[var(--dark)] text-[var(--cream)] text-sm tracking-widest disabled:opacity-30 transition-opacity">
                次へ進む
              </button>
            </div>
          </div>
        )}

        {/* Step 2: 日時選択 */}
        {step === 2 && (
          <div>
            <h2 className="font-display text-xl font-light tracking-wide mb-1">Date & Time</h2>
            <p className="text-xs text-[var(--muted)] tracking-wide mb-8 leading-relaxed">
              ご希望の日時をお選びください
            </p>

            <label className="block text-xs text-[var(--muted)] tracking-wide mb-2">日付</label>
            <select
              value={form.reservation_date}
              onChange={(e) => {
                setForm(f => ({ ...f, reservation_date: e.target.value, start_time: '' }));
                if (e.target.value) fetchAvailableSlots(e.target.value);
              }}
              className="w-full p-3 border border-[var(--light-line)] bg-[var(--card-bg)] text-sm mb-6 appearance-none"
            >
              <option value="">日付を選択</option>
              {dateOptions.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>

            {form.reservation_date && (
              <>
                <label className="block text-xs text-[var(--muted)] tracking-wide mb-2">時間帯</label>
                {loading ? (
                  <div className="text-center py-8 text-sm text-[var(--muted)]">読み込み中...</div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {availableSlots.map(slot => (
                      <button
                        key={slot.time}
                        disabled={!slot.available}
                        onClick={() => setForm(f => ({ ...f, start_time: slot.time }))}
                        className={`py-3 text-sm border transition-all
                          ${!slot.available ? 'border-[var(--light-line)] text-[var(--light-line)] cursor-not-allowed line-through' :
                            form.start_time === slot.time ? 'border-[var(--dark)] bg-[var(--dark)] text-[var(--cream)]' :
                            'border-[var(--light-line)] bg-[var(--card-bg)] hover:border-[var(--gold)]'}`}
                      >
                        {slot.time}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="flex gap-3 mt-8">
              <button onClick={() => setStep(1)}
                className="flex-1 py-4 border border-[var(--light-line)] text-sm tracking-widest text-[var(--muted)]">
                戻る
              </button>
              <button onClick={() => setStep(3)} disabled={!form.start_time}
                className="flex-1 py-4 bg-[var(--dark)] text-[var(--cream)] text-sm tracking-widest disabled:opacity-30 transition-opacity">
                次へ進む
              </button>
            </div>
          </div>
        )}

        {/* Step 3: お客様情報入力 */}
        {step === 3 && (
          <div>
            <h2 className="font-display text-xl font-light tracking-wide mb-1">Your Information</h2>
            <p className="text-xs text-[var(--muted)] tracking-wide mb-8 leading-relaxed">
              ご連絡先をご入力ください
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-xs text-[var(--muted)] tracking-wide mb-2">お名前 *</label>
                <input type="text" value={form.customer_name}
                  onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                  placeholder="山田 太郎"
                  className="w-full p-3 border border-[var(--light-line)] bg-[var(--card-bg)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] tracking-wide mb-2">メールアドレス</label>
                <input type="email" value={form.customer_email}
                  onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))}
                  placeholder="example@email.com"
                  className="w-full p-3 border border-[var(--light-line)] bg-[var(--card-bg)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] tracking-wide mb-2">電話番号</label>
                <input type="tel" value={form.customer_phone}
                  onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))}
                  placeholder="090-1234-5678"
                  className="w-full p-3 border border-[var(--light-line)] bg-[var(--card-bg)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] tracking-wide mb-2">その他ご要望・症状</label>
                <textarea value={form.concerns}
                  onChange={e => setForm(f => ({ ...f, concerns: e.target.value }))}
                  rows={3}
                  placeholder="気になる症状やご要望があればご記入ください"
                  className="w-full p-3 border border-[var(--light-line)] bg-[var(--card-bg)] text-sm resize-none" />
              </div>
            </div>

            <p className="text-[10px] text-[var(--muted)] mt-3">
              * メールアドレスまたは電話番号のいずれかは必須です
            </p>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setStep(2)}
                className="flex-1 py-4 border border-[var(--light-line)] text-sm tracking-widest text-[var(--muted)]">
                戻る
              </button>
              <button onClick={() => setStep(4)}
                disabled={!form.customer_name || (!form.customer_email && !form.customer_phone)}
                className="flex-1 py-4 bg-[var(--dark)] text-[var(--cream)] text-sm tracking-widest disabled:opacity-30 transition-opacity">
                確認画面へ
              </button>
            </div>
          </div>
        )}

        {/* Step 4: 確認画面 */}
        {step === 4 && (
          <div>
            <h2 className="font-display text-xl font-light tracking-wide mb-1">Confirmation</h2>
            <p className="text-xs text-[var(--muted)] tracking-wide mb-8 leading-relaxed">
              ご予約内容をご確認ください
            </p>

            <div className="border border-[var(--light-line)] bg-[var(--card-bg)] divide-y divide-[var(--light-line)]">
              <div className="p-4">
                <div className="text-[10px] text-[var(--muted)] tracking-wide mb-1">メニュー</div>
                <div className="text-sm">{selectedMenu?.name}</div>
                <div className="font-display text-lg text-[var(--gold)]">¥{selectedMenu?.price.toLocaleString()}</div>
              </div>
              <div className="p-4">
                <div className="text-[10px] text-[var(--muted)] tracking-wide mb-1">日時</div>
                <div className="text-sm">
                  {form.reservation_date && format(new Date(form.reservation_date), 'yyyy年M月d日（E）', { locale: ja })}
                  {' '}{form.start_time}〜
                </div>
              </div>
              <div className="p-4">
                <div className="text-[10px] text-[var(--muted)] tracking-wide mb-1">お名前</div>
                <div className="text-sm">{form.customer_name}</div>
              </div>
              {form.customer_email && (
                <div className="p-4">
                  <div className="text-[10px] text-[var(--muted)] tracking-wide mb-1">メールアドレス</div>
                  <div className="text-sm">{form.customer_email}</div>
                </div>
              )}
              {form.customer_phone && (
                <div className="p-4">
                  <div className="text-[10px] text-[var(--muted)] tracking-wide mb-1">電話番号</div>
                  <div className="text-sm">{form.customer_phone}</div>
                </div>
              )}
              {(selectedConcerns.length > 0 || form.concerns) && (
                <div className="p-4">
                  <div className="text-[10px] text-[var(--muted)] tracking-wide mb-1">お悩み・ご要望</div>
                  <div className="text-sm">{selectedConcerns.join('、')}{form.concerns && `、${form.concerns}`}</div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setStep(3)}
                className="flex-1 py-4 border border-[var(--light-line)] text-sm tracking-widest text-[var(--muted)]">
                戻る
              </button>
              <button onClick={handleSubmit} disabled={loading}
                className="flex-1 py-4 bg-[var(--dark)] text-[var(--cream)] text-sm tracking-widest disabled:opacity-50 transition-opacity">
                {loading ? '送信中...' : '予約する'}
              </button>
            </div>

            <p className="text-[10px] text-[var(--muted)] text-center mt-4">
              ※ 仮予約としてリクエストが送信されます
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
