"""
Dashboard の操作（ワンクリックWF / approve / reject / edit / レビュー一覧 / コンテンツ取得）。
内部で既存CLI関数(pipeline.cmd_*)を呼び、ログを捕捉して返す。
Knowledge Base を唯一の情報源とし、生成物はKBからのみ作る。
"""
from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path

from .. import pipeline
from .stats import ROOT, DATA, CONTENT, KB_DB

DRAFTS = DATA / "quizzes" / "drafts"
KBGEN = DATA / "quizzes" / "kb_generated"
APPROVED = DATA / "quizzes" / "approved"
REJECTED = DATA / "quizzes" / "rejected"


def _cap(fn, *a) -> list[str]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            fn(*a)
        except Exception as e:  # ログに残して継続
            print(f"エラー: {e}")
    return [ln for ln in buf.getvalue().splitlines() if ln.strip()]


def run_full_workflow(gen_formats=("quiz", "instagram", "slide", "youtube")) -> dict:
    """
    動画追加後の一括処理:
      Import → Claim抽出 → KB更新 → Evidence反映 → Quiz生成 →
      Instagram/Slide/YouTube生成 → QA → レビュー待ちへ配置。
    新規claimは needs_review のまま（人の検証待ち）＝安全設計。
    """
    log: list[str] = []
    log += ["== 1. Import / Claim抽出 =="] + _cap(pipeline.cmd_ingest)
    log += ["== 2. Evidence反映(検証済みclaim) =="] + _cap(pipeline.cmd_load_verified)
    log += ["== 3. Knowledge Base更新 =="] + _cap(pipeline.cmd_kb_build)
    log += ["== 4. Quiz生成(手書き定義→QA) =="] + _cap(pipeline.cmd_build_quiz)
    log += ["== 5. Quiz自動生成(グラフ・Evidence A) =="] + _cap(pipeline.cmd_kb_generate, "A", "")

    # verified claim を持つテーマを対象にコンテンツ生成
    subjects = _topics_with_verified()
    log += [f"== 6. コンテンツ生成 対象テーマ: {', '.join(subjects) or '(なし)'} =="]
    for subj in subjects[:8]:
        for fmt in gen_formats:
            if fmt == "quiz":
                continue  # quizは上で生成済み
            log += _cap(pipeline.cmd_generate, fmt, subj)
    log += ["== 7. QA/レビュー待ちへ配置 完了 =="]
    log += ["  ※ 新規claimは needs_review。医学レビュアの検証後に verified 化してください。"]
    return {"ok": True, "log": log}


def _topics_with_verified() -> list[str]:
    import sqlite3
    if not KB_DB.exists():
        return []
    c = sqlite3.connect(str(KB_DB)); c.row_factory = sqlite3.Row
    rows = c.execute(
        """SELECT DISTINCT t.name FROM topics t
           JOIN claims cl ON cl.topic_id=t.topic_id
           WHERE cl.verification_status='verified'""").fetchall()
    c.close()
    return [r["name"] for r in rows]


# ---- レビュー一覧 ----
def review_items(kind: str = "quiz") -> list[dict]:
    items: list[dict] = []
    if kind == "quiz":
        for folder in (DRAFTS, KBGEN):
            if folder.exists():
                for f in sorted(folder.glob("*.json")):
                    d = json.loads(f.read_text(encoding="utf-8"))
                    items.append({
                        "id": d.get("quiz_id"), "source_folder": folder.name,
                        "quiz_type": d.get("quiz_type", "multiple_choice"),
                        "chapter": d.get("chapter"), "level": d.get("level"),
                        "evidence_level": d.get("evidence_level"),
                        "question": d.get("question"),
                        "choices": d.get("choices"), "correct_answer": d.get("correct_answer"),
                        "explanation": d.get("explanation"),
                        "source_ids": d.get("source_ids"), "claim_ids": d.get("claim_ids"),
                        "review_status": d.get("review_status"),
                    })
    else:
        # instagram / slides / youtube / content
        fmap = {"instagram": "instagram_carousel.md", "slides": "halii_slide.md",
                "youtube": "youtube_script.md"}
        target = fmap.get(kind)
        if CONTENT.exists():
            for d in sorted(CONTENT.iterdir()):
                if not d.is_dir():
                    continue
                files = [d / target] if target else list(d.glob("*.md"))
                for f in files:
                    if f.exists():
                        items.append({"id": f"{d.name}/{f.name}", "subject": d.name,
                                      "format": f.stem, "path": str(f),
                                      "content": f.read_text(encoding="utf-8")})
    return items


def approve_quiz(quiz_id: str) -> dict:
    return {"log": _cap(pipeline.cmd_approve, quiz_id)}


def reject_quiz(quiz_id: str) -> dict:
    return {"log": _cap(pipeline.cmd_reject, quiz_id)}


EDITABLE = {"question", "choices", "correct_answer", "explanation",
            "choice_explanations", "practical_point", "individual_variation_note",
            "consent_note", "needs_verification"}


def edit_quiz(quiz_id: str, updates: dict) -> dict:
    """draft(またはkb_generated)のクイズを部分更新し、QA結果を返す。"""
    for folder in (DRAFTS, KBGEN):
        f = folder / f"{quiz_id}.json"
        if f.exists():
            d = json.loads(f.read_text(encoding="utf-8"))
            for k, v in updates.items():
                if k in EDITABLE:
                    d[k] = v
            f.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
            # draftならMarkdownも再生成
            try:
                from ..quiz_generation.generate import render_markdown
                from ..schemas import Quiz
                (folder / f"{quiz_id}.md").write_text(
                    render_markdown(Quiz.from_dict(d)), encoding="utf-8")
            except Exception:
                pass
            # QA
            from ..schemas import Quiz
            from ..validation.qa import qa_quiz
            r = qa_quiz(Quiz.from_dict(d))
            return {"ok": True, "publishable": r.publishable,
                    "errors": r.errors, "warnings": r.warnings}
    return {"ok": False, "error": f"{quiz_id} が drafts/kb_generated に見つかりません"}


def get_content(rel_path: str) -> str:
    p = (ROOT / rel_path).resolve()
    if str(p).startswith(str((ROOT / "data").resolve())) and p.exists():
        return p.read_text(encoding="utf-8")
    return "(ファイルが見つかりません)"
