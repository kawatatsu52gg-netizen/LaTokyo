#!/usr/bin/env python3
"""
analyze.py
----------
stocks.txt に書かれた日本株を IRBANK 等から取得し、
  * EPS の長期右肩上がりを A/B/C 判定
  * PER/PBR/ROE/配当利回り/営業利益率/自己資本比率/営業CF を取得
  * 100点満点で採点し ★ランク付け
  * Markdown レポートと stock_analysis.csv を出力
  * エラー銘柄はスキップし最後に一覧表示

使い方:
    python analyze.py                 # stocks.txt を読む
    python analyze.py --stocks foo.txt
    python analyze.py --sleep 1.5     # リクエスト間隔(秒, 相手サイトに配慮)
    python analyze.py --limit 5       # 先頭5銘柄だけ(動作確認用)

出力:
    stock_analysis.csv
    report.md         (--report で任意のパスに変更可)
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

import requests

import eval_core
from datasource import fetch_stock, StockData


# ---------------------------------------------------------------------------
def read_stocks(path: Path) -> list[str]:
    codes: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            codes.append(line)
    return codes


def analyze_one(data: StockData) -> dict:
    verdict = eval_core.classify_eps(data.eps_series, data.eps_forecast)
    score = eval_core.score_stock(
        eps_grade=verdict.grade,
        roe=data.roe,
        op_margin=data.op_margin,
        equity_ratio=data.equity_ratio,
        ocf_latest=data.ocf_latest,
        dividend_yield=data.div_yield,
        ocf_positive_years=data.ocf_positive_years,
        ocf_total_years=data.ocf_total_years,
    )
    p2 = eval_core.score_phase2(
        revenue_series=data.revenue_series,
        op_profit_series=data.op_profit_series,
        eps_series=data.eps_series,
        roe=data.roe,
        roic=data.roic,
        fcf_latest=data.fcf_latest,
        ocf_latest=data.ocf_latest,
        payout=data.payout_ratio,
        doe=data.doe,
        dividend_series=data.dividend_series,
        buyback_years=data.buyback_years,
        fcf_pos_years=data.fcf_positive_years,
        fcf_total_years=data.fcf_total_years,
        ocf_pos_years=data.ocf_positive_years,
        ocf_total_years=data.ocf_total_years,
    )
    return {
        "code": data.code,
        "name": data.name or "",
        "eps_grade": verdict.grade,
        "eps_reason": verdict.reason,
        "per": data.per,
        "pbr": data.pbr,
        "roe": data.roe,
        "op_margin": data.op_margin,
        "equity_ratio": data.equity_ratio,
        "ocf": data.ocf_latest,
        "div_yield": data.div_yield,
        "total": score.total,
        "rank": eval_core.rank_star(score.total),
        "breakdown": score.breakdown,
        # --- Phase 2 ---
        "rev_cagr": p2.metrics["rev_cagr"],
        "op_cagr": p2.metrics["op_cagr"],
        "eps_cagr": p2.metrics["eps_cagr"],
        "roic": data.roic,
        "fcf": data.fcf_latest,
        "doe": data.doe,
        "div_up_years": p2.metrics["div_up_years"],
        "buyback_years": data.buyback_years,
        "payout": data.payout_ratio,
        "p2_total": p2.total,
        "p2_rank": eval_core.rank_star(p2.total),
        "p2_breakdown": p2.breakdown,
    }


def _fmt(v, suffix=""):
    return f"{v:.1f}{suffix}" if isinstance(v, (int, float)) else "-"


# ---------------------------------------------------------------------------
def write_csv(rows: list[dict], path: Path) -> None:
    cols = ["コード", "会社名", "EPS評価", "PER", "PBR", "ROE",
            "営業利益率", "自己資本比率", "営業CF", "配当利回り",
            "総合点", "ランク", "コメント",
            # --- Phase 2 ---
            "売上成長率10y", "営業利益成長率10y", "EPS成長率10y",
            "ROIC", "FCF", "DOE", "増配年数", "自社株買い年数",
            "配当性向", "Phase2総合点", "Phase2ランク"]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([
                r["code"], r["name"], r["eps_grade"],
                r["per"], r["pbr"], r["roe"], r["op_margin"],
                r["equity_ratio"], r["ocf"], r["div_yield"],
                r["total"], r["rank"], r["eps_reason"],
                r["rev_cagr"], r["op_cagr"], r["eps_cagr"],
                r["roic"], r["fcf"], r["doe"], r["div_up_years"],
                r["buyback_years"], r["payout"], r["p2_total"], r["p2_rank"],
            ])


def write_report(rows: list[dict], errors: list[tuple[str, str]], path: Path) -> None:
    L: list[str] = []
    L.append("# 日本株ファンダメンタル分析レポート\n")

    # --- EPS 評価テーブル ---
    L.append("## EPS 右肩上がり評価\n")
    L.append("|コード|会社名|評価|理由|")
    L.append("|---|---|---|---|")
    for r in rows:
        L.append(f"|{r['code']}|{r['name']}|{r['eps_grade']}|{r['eps_reason']}|")
    L.append("")

    for grade, title in [("A", "A 一覧(非常にきれいな右肩上がり)"),
                         ("B", "B 一覧(減益はあるが回復・長期右肩上がり)"),
                         ("C", "C 一覧(乱高下/赤字/景気循環)")]:
        L.append(f"### {title}\n")
        hit = [r for r in rows if r["eps_grade"] == grade]
        if hit:
            for r in hit:
                L.append(f"- {r['code']} {r['name']}")
        else:
            L.append("- (該当なし)")
        L.append("")

    # --- 指標 + 総合点テーブル ---
    L.append("## 総合評価(100点満点)\n")
    L.append("|コード|会社名|EPS|PER|PBR|ROE|営業利益率|自己資本比率|営業CF|配当利回り|総合点|ランク|")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda x: x["total"], reverse=True):
        L.append("|{c}|{n}|{g}|{per}|{pbr}|{roe}|{om}|{eq}|{ocf}|{dy}|{t}|{rk}|".format(
            c=r["code"], n=r["name"], g=r["eps_grade"],
            per=_fmt(r["per"]), pbr=_fmt(r["pbr"]), roe=_fmt(r["roe"], "%"),
            om=_fmt(r["op_margin"], "%"), eq=_fmt(r["equity_ratio"], "%"),
            ocf=_fmt(r["ocf"]), dy=_fmt(r["div_yield"], "%"),
            t=r["total"], rk=r["rank"]))
    L.append("")

    # --- ランキング ---
    L.append("## 最終ランキング\n")
    buckets = [("★★★★★（90点以上）", 90, 999),
               ("★★★★☆（80〜89点）", 80, 90),
               ("★★★☆☆（70〜79点）", 70, 80),
               ("★★☆☆☆（60〜69点）", 60, 70),
               ("★☆☆☆☆（59点以下）", -999, 60)]
    for title, lo, hi in buckets:
        L.append(f"### {title}\n")
        hit = sorted([r for r in rows if lo <= r["total"] < hi],
                     key=lambda x: x["total"], reverse=True)
        if hit:
            for r in hit:
                L.append(f"- {r['code']} {r['name']} … {r['total']}点")
        else:
            L.append("- (該当なし)")
        L.append("")

    # --- Phase 2: 成長性 + 資本効率 + 株主還元 ---
    L.append("## Phase 2 総合評価(成長性・資本効率・株主還元)\n")
    L.append("|コード|会社名|売上成長率|営業利益成長率|EPS成長率|ROE|ROIC|FCF|"
             "配当性向|DOE|増配年数|自社株買い|営業CF|Phase2点|ランク|")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda x: x["p2_total"], reverse=True):
        L.append(
            "|{c}|{n}|{rc}|{oc}|{ec}|{roe}|{roic}|{fcf}|{po}|{doe}|{du}|{bb}|{ocf}|{t}|{rk}|".format(
                c=r["code"], n=r["name"],
                rc=_fmt(r["rev_cagr"], "%"), oc=_fmt(r["op_cagr"], "%"),
                ec=_fmt(r["eps_cagr"], "%"), roe=_fmt(r["roe"], "%"),
                roic=_fmt(r["roic"], "%"), fcf=_fmt(r["fcf"]),
                po=_fmt(r["payout"], "%"), doe=_fmt(r["doe"], "%"),
                du=r["div_up_years"] if r["div_up_years"] is not None else "-",
                bb=r["buyback_years"] if r["buyback_years"] is not None else "-",
                ocf=_fmt(r["ocf"]), t=r["p2_total"], rk=r["p2_rank"]))
    L.append("")

    L.append("### Phase 2 ランキング\n")
    p2_buckets = [("★★★★★（90点以上）", 90, 999),
                  ("★★★★☆（80〜89点）", 80, 90),
                  ("★★★☆☆（70〜79点）", 70, 80),
                  ("それ以下（69点以下）", -999, 70)]
    for title, lo, hi in p2_buckets:
        L.append(f"#### {title}\n")
        hit = sorted([r for r in rows if lo <= r["p2_total"] < hi],
                     key=lambda x: x["p2_total"], reverse=True)
        if hit:
            for r in hit:
                L.append(f"- {r['code']} {r['name']} … {r['p2_total']}点")
        else:
            L.append("- (該当なし)")
        L.append("")

    # --- エラー一覧 ---
    L.append("## 取得エラー銘柄\n")
    if errors:
        L.append("|コード|理由|")
        L.append("|---|---|")
        for code, msg in errors:
            L.append(f"|{code}|{msg}|")
    else:
        L.append("- なし")
    L.append("")

    path.write_text("\n".join(L), encoding="utf-8")


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stocks", default="stocks.txt")
    ap.add_argument("--out", default="stock_analysis.csv")
    ap.add_argument("--report", default="report.md")
    ap.add_argument("--sleep", type=float, default=1.5,
                    help="銘柄ごとのリクエスト間隔(秒)")
    ap.add_argument("--limit", type=int, default=0, help="先頭N銘柄のみ(0=全件)")
    ap.add_argument("--no-yahoo", action="store_true")
    ap.add_argument("--no-kabutan", action="store_true")
    args = ap.parse_args()

    stocks_path = Path(args.stocks)
    if not stocks_path.exists():
        print(f"[FATAL] {stocks_path} が見つかりません", file=sys.stderr)
        return 2

    codes = read_stocks(stocks_path)
    if args.limit:
        codes = codes[:args.limit]
    print(f"対象 {len(codes)} 銘柄を分析します\n")

    rows: list[dict] = []
    errors: list[tuple[str, str]] = []
    session = requests.Session()

    try:
        for i, code in enumerate(codes, 1):
            print(f"[{i}/{len(codes)}] {code} ...", end=" ", flush=True)
            try:
                data = fetch_stock(code, session,
                                   use_yahoo=not args.no_yahoo,
                                   use_kabutan=not args.no_kabutan)
                row = analyze_one(data)
                rows.append(row)
                print(f"OK  {row['eps_grade']}  {row['total']}点 {row['rank']}")
            except Exception as e:                      # noqa: BLE001
                errors.append((code, str(e)))
                print(f"SKIP ({e})")
            if args.sleep and i < len(codes):
                time.sleep(args.sleep)
    finally:
        session.close()

    if rows:
        write_csv(rows, Path(args.out))
        write_report(rows, errors, Path(args.report))
        print(f"\n出力: {args.out} / {args.report}")
    else:
        print("\n[WARN] 有効なデータが1件も取得できませんでした。"
              "ネットワーク/アクセス制限を確認してください。")

    if errors:
        print(f"\nエラー {len(errors)} 件:")
        for code, msg in errors:
            print(f"  - {code}: {msg}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
