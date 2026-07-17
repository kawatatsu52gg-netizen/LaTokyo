"""
クイズ生成層 (Quiz Designer エージェント)。

このシステムでは「医学的判断を伴うクイズ本文の作成」は
Quiz Designer（Claude + 人間レビュー）が行う。本モジュールは、

  (1) 生成された/手書きのクイズ定義を検証して drafts へ書き出す assembler
  (2) verified claim だけを材料に、章ごとのクイズ雛形(stub)を出す generator
  (3) 12項目フォーマットの Markdown レンダラ

を提供する。verified でない claim を材料にした問題は生成しない
（出典追跡・根拠管理のため）。
"""
from __future__ import annotations

import json
from pathlib import Path

from ..schemas import Quiz, CHAPTERS


def assemble_quiz(d: dict, verified_claim_ids: set[str]) -> tuple[Quiz | None, list[str]]:
    """dict からQuizをつくりつつID参照を検証。エラーがあれば (None, errors)。"""
    errs: list[str] = []
    q = Quiz.from_dict(d)
    errs.extend(q.validate())
    # claim_ids は verified に限定
    unknown = [cid for cid in q.claim_ids if cid not in verified_claim_ids]
    if unknown:
        errs.append(f"{q.quiz_id}: 未検証/不明な claim_ids を参照: {unknown}")
    if errs:
        return None, errs
    return q, []


def render_markdown(q: Quiz) -> str:
    """要件の12項目フォーマットで1問を Markdown 化。"""
    ch_name = CHAPTERS.get(q.chapter, "")
    lines = [
        f"### {q.quiz_id}  第{q.chapter}章「{ch_name}」/ Level {q.level}",
        "",
        f"**1. 問題**",
        f"{q.question}",
        "",
        "**2. 選択肢**",
        f"- A：{q.choices.get('A','')}",
        f"- B：{q.choices.get('B','')}",
        f"- C：{q.choices.get('C','')}",
        f"- D：{q.choices.get('D','')}",
        "",
        f"**3. 正解**：{q.correct_answer}",
        "",
        f"**4. 正解の理由**",
        f"{q.choice_explanations.get(q.correct_answer,'')}",
        "",
        "**5. 各不正解が誤りである理由**",
    ]
    for k in ("A", "B", "C", "D"):
        if k == q.correct_answer:
            continue
        lines.append(f"- {k}：{q.choice_explanations.get(k,'')}")
    lines += [
        "",
        "**6. 解剖学・神経生理学的解説**",
        f"{q.explanation}",
        "",
        "**7. 日常やパートナーとの対話への応用**",
        f"{q.practical_point or '（記載なし）'}",
        "",
        "**8. 個人差に関する注意**",
        f"{q.individual_variation_note or '（記載なし）'}",
    ]
    if q.consent_note:
        lines += ["", "**9. 同意・安全面の注意**", q.consent_note]
    lines += [
        "",
        "**10. 出典**",
        f"- source_ids: {', '.join(q.source_ids) or '—'}",
        f"- claim_ids: {', '.join(q.claim_ids) or '—'}",
        "",
        f"**11. エビデンスレベル**：{q.evidence_level}",
        "",
        f"**12. 要検証事項**：{q.needs_verification or 'なし'}",
        "",
        f"> review_status: `{q.review_status}`",
        "",
        "---",
        "",
    ]
    return "\n".join(lines)


def write_quiz_files(q: Quiz, drafts_dir: str | Path) -> tuple[Path, Path]:
    drafts = Path(drafts_dir)
    drafts.mkdir(parents=True, exist_ok=True)
    json_path = drafts / f"{q.quiz_id}.json"
    md_path = drafts / f"{q.quiz_id}.md"
    json_path.write_text(json.dumps(q.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(q), encoding="utf-8")
    return json_path, md_path


def generate_stubs(verified_claims: list[dict], target: int = 10) -> list[dict]:
    """
    verified claim から、章ごとにクイズ雛形(stub)を作る。
    本文は Quiz Designer(Claude/人間) が埋める前提で、
    材料 claim_id / source_id / 章 / エビデンスだけを埋めた枠を返す。
    """
    # topic -> chapter のざっくり対応
    topic_to_chapter = {
        "外性器・内性器": 1, "陰核": 2, "神経支配": 3, "感覚受容": 4,
        "骨盤底": 5, "性的興奮・血流": 6, "オーガズム": 7,
        "痛み・過緊張": 8, "個人差・コミュニケーション": 9, "俗説の訂正": 10,
    }
    stubs: list[dict] = []
    for i, c in enumerate(verified_claims[:target], start=1):
        ch = topic_to_chapter.get(c.get("topic", ""), 1)
        stubs.append({
            "quiz_id": f"Q-STUB-{i:04d}",
            "chapter": ch,
            "level": 1,
            "question": "（Quiz Designerが作成）",
            "choices": {"A": "", "B": "", "C": "", "D": ""},
            "correct_answer": "A",
            "explanation": "",
            "choice_explanations": {"A": "", "B": "", "C": "", "D": ""},
            "practical_point": "",
            "individual_variation_note": "",
            "consent_note": "",
            "source_ids": [],
            "claim_ids": [c.get("claim_id", "")],
            "evidence_level": c.get("evidence_level", "B"),
            "needs_verification": "",
            "review_status": "draft",
            "_material_statement": c.get("statement", ""),
        })
    return stubs
