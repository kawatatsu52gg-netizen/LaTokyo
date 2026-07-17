"""
レポート生成層。

QA 結果と生成物から、人間が確認できる Markdown レポートを作る。
承認前の問題を公開データに混ぜないため、レポートは
draft/approved/rejected の状態を明示する。
"""
from __future__ import annotations

from pathlib import Path

from ..schemas import Quiz, CHAPTERS
from ..validation.qa import QAResult


def build_report(
    quizzes: list[Quiz],
    qa_results: dict[str, QAResult],
    duplicates: list[tuple[str, str]],
    source_count: int,
    claim_total: int,
    claim_verified: int,
    generated_at: str,
) -> str:
    ok = [q for q in quizzes if qa_results[q.quiz_id].publishable]
    ng = [q for q in quizzes if not qa_results[q.quiz_id].publishable]

    lines = [
        "# クイズ生成 QA レポート",
        "",
        f"- 生成日時: {generated_at}",
        f"- 情報源(source): {source_count} 件",
        f"- 主張(claim): 合計 {claim_total} / うち verified {claim_verified}",
        f"- クイズ: 合計 {len(quizzes)} / 公開可 {len(ok)} / 公開不可 {len(ng)}",
        f"- 重複疑い: {len(duplicates)} 組",
        "",
        "## サマリ（章別）",
        "",
        "| 章 | タイトル | 問題数 | 公開可 |",
        "|---|---|---|---|",
    ]
    for ch, name in CHAPTERS.items():
        chq = [q for q in quizzes if q.chapter == ch]
        cho = [q for q in chq if qa_results[q.quiz_id].publishable]
        if chq:
            lines.append(f"| {ch} | {name} | {len(chq)} | {len(cho)} |")
    lines += ["", "## 問題別チェック結果", ""]

    for q in quizzes:
        r = qa_results[q.quiz_id]
        status = "✅ 公開可" if r.publishable else "⛔ 公開不可"
        lines.append(f"### {q.quiz_id}  第{q.chapter}章 / Lv{q.level}  — {status}")
        lines.append(f"- 設問: {q.question[:60]}")
        lines.append(f"- エビデンス: {q.evidence_level} / review_status: {q.review_status}")
        lines.append(f"- 出典: claim_ids={q.claim_ids} source_ids={q.source_ids}")
        if r.errors:
            lines.append("- ⛔ エラー:")
            lines += [f"    - {e}" for e in r.errors]
        if r.warnings:
            lines.append("- ⚠️ 警告:")
            lines += [f"    - {w}" for w in r.warnings]
        if not r.errors and not r.warnings:
            lines.append("- 指摘なし")
        lines.append("")

    if duplicates:
        lines += ["## 重複疑い", ""]
        lines += [f"- {a} ≈ {b}" for a, b in duplicates]
        lines.append("")

    lines += [
        "## 次のアクション",
        "",
        "1. ⛔ 公開不可の問題を修正、または rejected へ。",
        "2. ⚠️ 警告のある問題を人間（できれば医療者）が確認。",
        "3. 問題なければ `python -m src.pipeline approve <quiz_id>` で approved へ移動。",
        "4. approved の問題のみが公開データです（draft は公開しない）。",
        "",
    ]
    return "\n".join(lines)


def write_report(text: str, reports_dir: str | Path, name: str = "qa_report.md") -> Path:
    d = Path(reports_dir)
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_text(text, encoding="utf-8")
    return p
