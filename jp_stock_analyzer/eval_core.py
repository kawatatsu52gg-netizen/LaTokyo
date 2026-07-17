"""
eval_core.py
------------
純粋関数だけを集めたモジュール。ネットワークにも外部サイトにも一切依存しない
ので、そのまま単体テスト(`python eval_core.py`)で検証できる。

ここに置くもの:
  * classify_eps()  : EPS 系列 → A / B / C 判定
  * score_stock()   : 各種指標 → 100 点満点のスコアと内訳
  * rank_star()     : 総合点 → ★の数(ランク文字列)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# 1. EPS 右肩上がり判定 (A / B / C)
# ---------------------------------------------------------------------------
@dataclass
class EpsVerdict:
    grade: str          # "A" / "B" / "C"
    reason: str         # 日本語の理由
    detail: dict = field(default_factory=dict)


def classify_eps(eps_series: list[Optional[float]],
                 forecast: Optional[float] = None) -> EpsVerdict:
    """
    EPS の年次系列(古い→新しい順)を受け取り A/B/C を返す。

    判定基準(ユーザー定義):
      A: ほぼ毎年 EPS が増加。減少は1回だけ・軽微な程度。長期で非常にきれいな右肩上がり。
      B: 途中で減少した年があるが回復し、過去最高 EPS を更新している。長期では右肩上がり。
      C: 乱高下 / 赤字 / 右肩上がりでない / 景気循環に大きく左右される。

    forecast(最新予想EPS)が与えられれば、系列の末尾に加えて評価する。
    """
    vals: list[float] = [v for v in eps_series if v is not None]
    if forecast is not None:
        vals = vals + [forecast]

    if len(vals) < 3:
        return EpsVerdict("C", "データ不足で判定できない", {"n": len(vals)})

    n = len(vals)
    first, last = vals[0], vals[-1]
    peak = max(vals)
    has_negative = any(v < 0 for v in vals)

    # 前年比の下落を集計(下落率 = 前年からの減少幅 / |前年値|)
    drops: list[float] = []
    for i in range(1, n):
        prev, cur = vals[i - 1], vals[i]
        if cur < prev:
            base = abs(prev) if prev != 0 else 1.0
            drops.append((prev - cur) / base)

    num_dec = len(drops)
    big_drops = [d for d in drops if d > 0.30]        # 30%超の急減
    minor_only = all(d <= 0.10 for d in drops)        # 全ての下落が10%以内=軽微
    # 直近が過去最高(あるいはそれに極めて近い)か
    new_high = last >= peak * 0.999
    grew_long_term = last > first

    detail = {
        "n": n, "first": first, "last": last, "peak": peak,
        "num_decreases": num_dec, "big_drops": len(big_drops),
        "new_high": new_high, "has_negative": has_negative,
    }

    # --- C: 明確に右肩上がりでない ---------------------------------------
    if has_negative:
        return EpsVerdict("C", "赤字の年があり右肩上がりではない", detail)
    if not grew_long_term:
        return EpsVerdict("C", "長期でEPSが増えておらず右肩上がりではない", detail)
    if len(big_drops) >= 2:
        return EpsVerdict("C", "大幅な増減を繰り返しており景気変動の影響が大きい", detail)

    # --- A: 非常にきれいな右肩上がり ------------------------------------
    if num_dec <= 1 and minor_only:
        return EpsVerdict("A", "ほぼ毎年EPSが増加し長期で非常にきれいな右肩上がり", detail)

    # --- B: 途中で減益も回復し過去最高を更新 ----------------------------
    if new_high:
        return EpsVerdict("B", "途中で減益はあるが回復し過去最高EPSを更新、長期では右肩上がり", detail)

    # 上記に当てはまらないが長期では増えている → 緩い右肩上がり=B、
    # ただし大きめの下落が1回でもあり直近が最高値でない場合は C 寄り。
    if len(big_drops) >= 1:
        return EpsVerdict("C", "減益局面が大きく直近も最高益を更新できておらず右肩上がりとは言い切れない", detail)
    return EpsVerdict("B", "長期では増加傾向だが途中に減益局面がある", detail)


# ---------------------------------------------------------------------------
# 2. 100点満点スコアリング
# ---------------------------------------------------------------------------
# 配点: EPS右肩上がり40 / ROE20 / 営業利益率15 / 自己資本比率10 / 営業CF10 / 配当利回り5

def _score_eps(grade: str) -> float:
    return {"A": 40.0, "B": 27.0, "C": 12.0}.get(grade, 0.0)


def _score_roe(roe: Optional[float]) -> float:          # roe は % 表記 (例 15.0)
    if roe is None:
        return 0.0
    if roe >= 15:  return 20.0
    if roe >= 12:  return 17.0
    if roe >= 10:  return 14.0
    if roe >= 8:   return 11.0
    if roe >= 5:   return 7.0
    if roe > 0:    return 3.0
    return 0.0


def _score_op_margin(m: Optional[float]) -> float:      # 営業利益率 %
    if m is None:
        return 0.0
    if m >= 20: return 15.0
    if m >= 15: return 13.0
    if m >= 10: return 10.0
    if m >= 7:  return 7.0
    if m >= 5:  return 5.0
    if m > 0:   return 2.0
    return 0.0


def _score_equity(e: Optional[float]) -> float:         # 自己資本比率 %
    if e is None:
        return 0.0
    if e >= 70: return 10.0
    if e >= 60: return 9.0
    if e >= 50: return 8.0
    if e >= 40: return 6.0
    if e >= 30: return 4.0
    if e > 0:   return 2.0
    return 0.0


def _score_ocf(ocf_latest: Optional[float],
               ocf_positive_years: Optional[int] = None,
               ocf_total_years: Optional[int] = None) -> float:
    """営業CF。直近がプラスで、かつ過去も概ねプラスなら高得点。"""
    if ocf_latest is None:
        return 0.0
    if ocf_latest <= 0:
        return 0.0
    if ocf_positive_years is not None and ocf_total_years:
        ratio = ocf_positive_years / ocf_total_years
        if ratio >= 0.9:  return 10.0
        if ratio >= 0.7:  return 8.0
        return 6.0
    return 8.0  # 直近プラスのみ確認できた場合


def _score_dividend(y: Optional[float]) -> float:       # 配当利回り %
    if y is None:
        return 0.0
    if y >= 4:  return 5.0
    if y >= 3:  return 4.0
    if y >= 2:  return 3.0
    if y >= 1:  return 2.0
    if y > 0:   return 1.0
    return 0.0


@dataclass
class Score:
    total: float
    breakdown: dict


def score_stock(eps_grade: str,
                roe: Optional[float],
                op_margin: Optional[float],
                equity_ratio: Optional[float],
                ocf_latest: Optional[float],
                dividend_yield: Optional[float],
                ocf_positive_years: Optional[int] = None,
                ocf_total_years: Optional[int] = None) -> Score:
    bd = {
        "EPS(40)":       round(_score_eps(eps_grade), 1),
        "ROE(20)":       round(_score_roe(roe), 1),
        "営業利益率(15)": round(_score_op_margin(op_margin), 1),
        "自己資本比率(10)": round(_score_equity(equity_ratio), 1),
        "営業CF(10)":    round(_score_ocf(ocf_latest, ocf_positive_years, ocf_total_years), 1),
        "配当利回り(5)":  round(_score_dividend(dividend_yield), 1),
    }
    return Score(round(sum(bd.values()), 1), bd)


# ---------------------------------------------------------------------------
# 3. ランク(★)
# ---------------------------------------------------------------------------
def rank_star(total: float) -> str:
    if total >= 90: return "★★★★★"
    if total >= 80: return "★★★★☆"
    if total >= 70: return "★★★☆☆"
    if total >= 60: return "★★☆☆☆"
    return "★☆☆☆☆"


# ---------------------------------------------------------------------------
# 単体テスト
# ---------------------------------------------------------------------------
def _selftest() -> None:
    # A: 毎年きれいに増加
    v = classify_eps([10, 12, 13, 15, 18, 20, 23, 25, 28, 31])
    assert v.grade == "A", v

    # A: 1回だけ軽微な減少 (18->17, 約5.5%減)
    v = classify_eps([10, 12, 15, 18, 17, 20, 24, 27, 30, 34])
    assert v.grade == "A", v

    # B: 途中で大きく減益→回復して過去最高更新
    v = classify_eps([20, 25, 30, 12, 18, 28, 35, 40, 45, 52])
    assert v.grade == "B", v

    # C: 赤字あり
    v = classify_eps([10, 15, -5, 8, 12, 20, 18, 22, 25, 30])
    assert v.grade == "C", v

    # C: 乱高下(30%超の急減が複数回=景気循環株)
    v = classify_eps([100, 40, 90, 30, 120, 45, 110, 35, 130, 50])
    assert v.grade == "C", v

    # C: 長期で増えていない
    v = classify_eps([50, 45, 48, 40, 42, 38, 41, 39, 44, 43])
    assert v.grade == "C", v

    # スコア/ランク
    s = score_stock("A", roe=18, op_margin=22, equity_ratio=72,
                    ocf_latest=100, dividend_yield=4.2,
                    ocf_positive_years=10, ocf_total_years=10)
    assert s.total == 100.0, s
    assert rank_star(s.total) == "★★★★★"

    s2 = score_stock("C", roe=3, op_margin=4, equity_ratio=25,
                     ocf_latest=-5, dividend_yield=0.5)
    assert s2.total < 60, s2
    assert rank_star(s2.total) == "★☆☆☆☆"

    print("eval_core selftest: OK")


if __name__ == "__main__":
    _selftest()
