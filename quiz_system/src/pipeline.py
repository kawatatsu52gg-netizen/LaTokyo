"""
パイプライン オーケストレータ (CLI)。

使い方:
    python -m src.pipeline ingest         # inbox取り込み→sources/claims(要検証)
    python -m src.pipeline load-verified  # 検証済みclaimsをDBへ登録
    python -m src.pipeline build-quiz      # quiz_source.jsonからdrafts生成+QA
    python -m src.pipeline approve <id>    # 公開可のdraftをapprovedへ
    python -m src.pipeline reject <id>     # draftをrejectedへ
    python -m src.pipeline report          # 最新QAレポート再生成
    python -m src.pipeline run-all         # ingest→load-verified→build-quiz→report
    python -m src.pipeline status          # 現在の集計

設計:
  - 各ステップは冪等（何度実行しても壊れない）。
  - 例外はファイル単位で捕捉し、処理を止めずログに残す（失敗時の再実行が容易）。
  - 承認前(draft)の問題は approved フォルダに混ざらない。
"""
from __future__ import annotations

import json
import sys
import shutil
import traceback
from datetime import datetime, timezone
from pathlib import Path

from .schemas import Source, Claim, Quiz
from .db import DB
from .ingestion.ingest import iter_inbox, ingest_file
from .normalization.normalize import (
    normalize_body, extract_candidates, candidates_from_csv_rows,
)
from .claims.extract import build_claims
from .quiz_generation.generate import assemble_quiz, write_quiz_files
from .validation.qa import qa_quiz, detect_duplicates
from .validation.score import score_quiz
from .export.report import build_report, write_report


ROOT = Path(__file__).resolve().parent.parent  # quiz_system/
CONFIG = json.loads((ROOT / "config" / "config.json").read_text(encoding="utf-8"))
P = {k: ROOT / v for k, v in CONFIG["paths"].items()}


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S%z")


def log(msg: str) -> None:
    line = f"[{_now()}] {msg}"
    print(line)
    P["logs"].parent.mkdir(parents=True, exist_ok=True)
    with open(P["logs"], "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _db() -> DB:
    return DB(P["database"])


# --- ingest -------------------------------------------------------------

def cmd_ingest() -> None:
    db = _db()
    files = iter_inbox(P["inbox"])
    if not files:
        log(f"ingest: inbox({P['inbox']}) に対象ファイルがありません。")
        db.close()
        return

    sources_out: list[dict] = []
    index_out: list[dict] = []
    all_claims: list[dict] = []
    claim_counter = 1

    for f in files:
        try:
            res = ingest_file(f)
            for w in res.warnings:
                log(f"ingest 警告: {w}")

            # 重複検出（内容ハッシュ / URL）
            dup_id = db.find_source_by_hash(res.content_hash)
            url = res.meta.get("youtube_url", "")
            dup_url = db.find_source_by_url(url)
            if dup_id or dup_url:
                log(f"ingest: 重複検出 {f.name} は既存 {dup_id or dup_url} と同一内容のためスキップ")
                continue

            source_id = db.next_id("sources", "SRC-", "source_id")

            # 候補文 -> claims
            if res.rows:
                cands = candidates_from_csv_rows(res.rows)
            else:
                cands = extract_candidates(res.body)
            claims = build_claims(cands, start_index=claim_counter)
            claim_counter += len(claims)

            # 生テキスト・正規化テキストを保存（原文/要約を分離保持）
            P["raw"].mkdir(parents=True, exist_ok=True)
            P["normalized"].mkdir(parents=True, exist_ok=True)
            (P["raw"] / f"{source_id}_{f.name}").write_text(
                res.body, encoding="utf-8")
            (P["normalized"] / f"{source_id}.txt").write_text(
                normalize_body(res.body), encoding="utf-8")

            src = Source(
                source_id=source_id,
                source_type=res.meta.get("source_type", "youtube"),
                title=res.meta.get("title", f.stem),
                youtube_url=url,
                channel_name=res.meta.get("channel_name", ""),
                published_at=res.meta.get("published_at", ""),
                imported_at=_now(),
                notebook_name=res.meta.get("notebook_name", ""),
                notebook_export_file=f.name,
                content_hash=res.content_hash,
                claims=claims,
            )
            errs = src.validate()
            for e in errs:
                log(f"ingest 検証: {e}")

            db.upsert_source(src)
            sources_out.append(src.to_dict())
            index_out.append({
                "source_id": source_id,
                "title": src.title,
                "youtube_url": src.youtube_url,
                "channel_name": src.channel_name,
                "notebook_export_file": f.name,
                "meta_complete": res.meta_complete,
                "missing_required": res.missing_required,
                "claim_count": len(claims),
                "needs_review": sum(1 for c in claims if c.verification_status == "needs_review"),
            })
            if not res.meta_complete:
                log(f"ingest 注意: {source_id} は必須メタ {res.missing_required} が欠落。"
                    "この情報源のclaimはverified化できません。")
            all_claims.extend(c.to_dict() for c in claims)
            log(f"ingest: {f.name} -> {source_id} (claims={len(claims)}, 全て要検証)")
        except Exception as e:  # 失敗してもファイル単位で継続
            log(f"ingest エラー: {f.name} を処理できませんでした: {e}")
            log(traceback.format_exc())

    # JSON書き出し（人が読める成果物）
    P["sources_json"].parent.mkdir(parents=True, exist_ok=True)
    _merge_json_list(P["sources_json"], sources_out, key="source_id")
    _merge_json_list(P["source_index"], index_out, key="source_id")
    _merge_json_list(P["claims_json"], all_claims, key="claim_id")
    db.close()
    log(f"ingest 完了: sources={len(sources_out)}, claims(要検証)={len(all_claims)}")


def _merge_json_list(path: Path, new_items: list[dict], key: str) -> None:
    existing: list[dict] = []
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            existing = []
    by_key = {it.get(key): it for it in existing}
    for it in new_items:
        by_key[it.get(key)] = it
    path.write_text(json.dumps(list(by_key.values()), ensure_ascii=False, indent=2),
                    encoding="utf-8")


# --- load-verified ------------------------------------------------------

def cmd_load_verified() -> None:
    """
    Medical Evidence Reviewer の判定を DB に反映する（3分類の振り分け）。
      - data/claims/verified_claims.json … 照合済みで確定 → verified
      - data/claims/rejected_claims.json … 誤り・俗説と判定 → rejected
      - それ以外の自動抽出claim … needs_review のまま（既定）
    NotebookLMの要約を無条件に事実扱いせず、claim単位で状態を持たせる。
    """
    db = _db()
    base = P["claims_json"].parent
    n_v = n_r = 0

    vpath = base / "verified_claims.json"
    if vpath.exists():
        for d in json.loads(vpath.read_text(encoding="utf-8")):
            c = Claim.from_dict(d)
            c.verification_status = "verified"
            errs = c.validate()
            if errs:
                log(f"load-verified 検証NG {c.claim_id}: {errs}")
                continue
            db.upsert_claim(d.get("source_id", ""), c)
            n_v += 1
    else:
        log(f"load-verified: {vpath} が無いためスキップ（verified未登録）。")

    rpath = base / "rejected_claims.json"
    if rpath.exists():
        for d in json.loads(rpath.read_text(encoding="utf-8")):
            c = Claim.from_dict(d)
            c.verification_status = "rejected"
            db.upsert_claim(d.get("source_id", ""), c)
            n_r += 1

    db.conn.commit()
    db.close()
    log(f"load-verified 完了: verified {n_v} 件 / rejected {n_r} 件を反映")


# --- build-quiz ---------------------------------------------------------

def cmd_build_quiz() -> None:
    """
    Quiz Designer が作成した quiz_source.json を検証して drafts に展開し、
    QA を実行してレポートを書く。
    verified claim を参照しない問題は生成しない。
    """
    db = _db()
    verified = db.get_verified_claims()
    verified_ids = {c["claim_id"] for c in verified}
    log(f"build-quiz: verified claim {len(verified_ids)} 件を材料に使用")

    qsrc = P["quiz_drafts"].parent / "quiz_source.json"
    if not qsrc.exists():
        log(f"build-quiz: {qsrc} が無いためスキップ。")
        db.close()
        return
    defs = json.loads(qsrc.read_text(encoding="utf-8"))

    built: list[Quiz] = []
    for d in defs:
        q, errs = assemble_quiz(d, verified_ids)
        if errs:
            log(f"build-quiz 除外: {d.get('quiz_id','?')} -> {errs}")
            continue
        q.review_status = "reviewed"  # 生成成功=スキーマ/出典整合済み
        write_quiz_files(q, P["quiz_drafts"])
        db.upsert_quiz(q)
        built.append(q)
        log(f"build-quiz: {q.quiz_id} をdraftsへ書き出し")

    # QA + 採点
    qa_results = {q.quiz_id: qa_quiz(q, CONFIG.get("qa", {})) for q in built}
    scorecards = {q.quiz_id: score_quiz(q) for q in built}
    dups = detect_duplicates(built)

    report = build_report(
        quizzes=built,
        qa_results=qa_results,
        duplicates=dups,
        source_count=db.count("sources"),
        claim_total=db.count("claims"),
        claim_verified=len(verified_ids),
        generated_at=_now(),
        scorecards=scorecards,
    )
    write_report(report, P["reports"])
    db.close()

    pub = sum(1 for r in qa_results.values() if r.publishable)
    fix = sum(1 for s in scorecards.values() if s.needs_fix)
    log(f"build-quiz 完了: {len(built)}問生成 / 公開可 {pub} / 要修正 {fix} / "
        f"レポート: {P['reports']/'qa_report.md'}")


# --- approve / reject ---------------------------------------------------

def _move_quiz(quiz_id: str, dest_dir: Path, new_status: str, guard_publishable: bool) -> None:
    src_json = P["quiz_drafts"] / f"{quiz_id}.json"
    if not src_json.exists():
        log(f"{new_status}: {quiz_id} は drafts に存在しません。")
        return
    q = Quiz.from_dict(json.loads(src_json.read_text(encoding="utf-8")))
    if guard_publishable:
        r = qa_quiz(q, CONFIG.get("qa", {}))
        if not r.publishable:
            log(f"approve 不可: {quiz_id} はQA公開不可（{r.errors}）。修正が必要です。")
            return
    q.review_status = new_status
    dest_dir.mkdir(parents=True, exist_ok=True)
    from .quiz_generation.generate import render_markdown
    (dest_dir / f"{quiz_id}.json").write_text(
        json.dumps(q.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    (dest_dir / f"{quiz_id}.md").write_text(render_markdown(q), encoding="utf-8")
    # draft からは撤去（公開前後を混在させない）
    src_json.unlink(missing_ok=True)
    (P["quiz_drafts"] / f"{quiz_id}.md").unlink(missing_ok=True)
    db = _db(); db.upsert_quiz(q); db.close()
    log(f"{new_status}: {quiz_id} を {dest_dir.name} へ移動")


def cmd_approve(quiz_id: str) -> None:
    _move_quiz(quiz_id, P["quiz_approved"], "approved", guard_publishable=True)


def cmd_reject(quiz_id: str) -> None:
    _move_quiz(quiz_id, P["quiz_rejected"], "rejected", guard_publishable=False)


# --- status -------------------------------------------------------------

def cmd_status() -> None:
    db = _db()
    log("=== ステータス ===")
    log(f"sources: {db.count('sources')}")
    log(f"claims : {db.count('claims')} (verified {len(db.get_verified_claims())})")
    log(f"quizzes(DB): {db.count('quizzes')}")
    for name, d in (("drafts", P["quiz_drafts"]), ("approved", P["quiz_approved"]),
                    ("rejected", P["quiz_rejected"])):
        n = len(list(d.glob("*.json"))) if d.exists() else 0
        log(f"{name}: {n}")
    db.close()


def cmd_report() -> None:
    cmd_build_quiz()  # レポートは build-quiz が生成するため再実行


def cmd_run_all() -> None:
    log("=== run-all 開始 ===")
    cmd_ingest()
    cmd_load_verified()
    cmd_build_quiz()
    cmd_status()
    log("=== run-all 完了 ===")


COMMANDS = {
    "ingest": cmd_ingest,
    "load-verified": cmd_load_verified,
    "build-quiz": cmd_build_quiz,
    "report": cmd_report,
    "status": cmd_status,
    "run-all": cmd_run_all,
}


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd = argv[0]
    if cmd == "approve":
        if len(argv) < 2:
            print("usage: approve <quiz_id>"); return 1
        cmd_approve(argv[1]); return 0
    if cmd == "reject":
        if len(argv) < 2:
            print("usage: reject <quiz_id>"); return 1
        cmd_reject(argv[1]); return 0
    fn = COMMANDS.get(cmd)
    if not fn:
        print(f"unknown command: {cmd}\n"); print(__doc__); return 1
    fn()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
