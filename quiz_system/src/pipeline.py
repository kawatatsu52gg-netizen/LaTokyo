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
from .validation.evaluate import evaluate_quiz
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
    # drafts と kb_generated の両方から探す（Review Centerからの承認に対応）
    src_json = P["quiz_drafts"] / f"{quiz_id}.json"
    kbgen = P["quiz_drafts"].parent / "kb_generated" / f"{quiz_id}.json"
    if not src_json.exists() and kbgen.exists():
        src_json = kbgen
    if not src_json.exists():
        log(f"{new_status}: {quiz_id} は drafts / kb_generated に存在しません。")
        return
    src_md = src_json.with_suffix(".md")
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
    # 元(draft/kb_generated)からは撤去（公開前後を混在させない）
    src_json.unlink(missing_ok=True)
    src_md.unlink(missing_ok=True)
    db = _db(); db.upsert_quiz(q); db.close()
    log(f"{new_status}: {quiz_id} を {dest_dir.name} へ移動")


def cmd_approve(quiz_id: str) -> None:
    _move_quiz(quiz_id, P["quiz_approved"], "approved", guard_publishable=True)


def cmd_reject(quiz_id: str) -> None:
    _move_quiz(quiz_id, P["quiz_rejected"], "rejected", guard_publishable=False)


# --- status -------------------------------------------------------------

def cmd_kb_build() -> None:
    """各種シード/既存データを Knowledge Base(kb.db) に統合する。"""
    from .kb.build import build
    stats = build(ROOT / "data" / "database" / "kb.db", log=log)
    log("kb-build 完了:")
    for k, v in stats.items():
        log(f"  {k}: {v}")


def cmd_kb_stats() -> None:
    from .kb.store import KB
    kb = KB(ROOT / "data" / "database" / "kb.db")
    log("=== KB 統計 ===")
    log(f"topics={kb.count('topics')} sources={kb.count('sources')} "
        f"entities={kb.count('entities')} claims={kb.count('claims')} edges={kb.count('edges')}")
    log(f"sources種別: {kb.counts_by('sources','source_type')}")
    log(f"entities種別: {kb.counts_by('entities','etype')}")
    log(f"claims エビデンス: {kb.counts_by('claims','evidence_level')}")
    log(f"edges エビデンス: {kb.counts_by('edges','evidence_level')}")
    kb.close()


def cmd_kb_generate(min_evidence: str = "A", topic_id: str = "") -> None:
    """
    ナレッジグラフから4種(穴埋め/4択/応用/ケース)のクイズを自動生成。
    Evidence>=min_evidence のエッジ/パスのみ使用。QAを通し、draftとして保存。
    """
    from .kb.store import KB
    from .kb.generate_kb import generate
    kb = KB(ROOT / "data" / "database" / "kb.db")
    quizzes = generate(kb, min_evidence=min_evidence, topic_id=topic_id or None)
    outdir = P["quiz_drafts"].parent / "kb_generated"
    outdir.mkdir(parents=True, exist_ok=True)

    by_type: dict[str, int] = {}
    passed = 0
    md_lines = [f"# ナレッジグラフ自動生成クイズ（Evidence {min_evidence}以上・未承認draft）", ""]
    for qd in quizzes:
        q = Quiz.from_dict(qd)
        r = qa_quiz(q, CONFIG.get("qa", {}))
        ok = r.publishable
        passed += 1 if ok else 0
        by_type[qd["quiz_type"]] = by_type.get(qd["quiz_type"], 0) + 1
        kb.upsert_quiz(qd)
        (outdir / f"{q.quiz_id}.json").write_text(
            json.dumps(qd, ensure_ascii=False, indent=2), encoding="utf-8")
        md_lines += [
            f"## {q.quiz_id}  [{qd['quiz_type']}] 第{q.chapter}章/Lv{q.level}  "
            f"Evidence {q.evidence_level}  QA:{'OK' if ok else 'NG'}",
            f"- 問題: {q.question}",
            *[f"  - {k}: {q.choices[k]}" + ("　◀正解" if k == q.correct_answer else "") for k in "ABCD"],
            f"- 解説: {q.explanation}",
            f"- 出典: claim_ids={q.claim_ids} source_ids={q.source_ids}",
            "",
        ]
    kb.commit(); kb.close()
    (outdir / "kb_generated.md").write_text("\n".join(md_lines), encoding="utf-8")
    log(f"kb-generate 完了(Evidence>={min_evidence}): 生成{len(quizzes)}問 種別{by_type} / QA公開可{passed}")
    log(f"  → {outdir}/ に保存（draft・未承認）")


def cmd_generate(fmt: str, subject: str) -> None:
    """generate <format> <subject>: KBから1形式のコンテンツを生成。"""
    from .content.generator import generate_content
    generate_content(ROOT / "data" / "database" / "kb.db", fmt, subject, log=log)


def cmd_content_all(subject: str) -> None:
    """content-all <subject>: KBから全形式のコンテンツを生成（KB更新後の一括再生成に）。"""
    from .content.generator import generate_all
    outs = generate_all(ROOT / "data" / "database" / "kb.db", subject, log=log)
    log(f"content-all 完了: {len(outs)}形式を生成（主題『{subject}』）")


def cmd_research() -> None:
    """Research Team の日次分析（完成度/ギャップ/Evidence Coverage/研究キュー）を出力。"""
    from .research import team
    r = team.run_daily()
    log(f"=== Research Team ===  KB完成度: {r['completeness']}%")
    g = r["gaps"]
    weak = [f"{x['name']}({x['have']}/{x['want']})" for x in g["weak_evidence"]]
    qgap = [f"{x['name']}({x['have']}/{x['want']})" for x in g["quiz_gaps"]]
    log(f"未登録テーマ: {g['missing_topics'] or 'なし'}")
    log(f"Evidence不足: {weak or 'なし'}")
    log(f"Quiz不足: {qgap or 'なし'}")
    log(f"Evidence A/B割合: {r['evidence_coverage'].get('ab_ratio', 0)}%")
    log("Research Scout キュー:")
    for q in r["scout_queue"]:
        log(f"  [{q['priority']}] {q['subject']} — {q['reason']}")
    log(f"  詳細レポート: data/research/daily_research.md")


def cmd_research_design(subject: str) -> None:
    """Learning Designer: あるテーマの学習コンテンツ一式を生成。"""
    from .research.designer import design
    r = design(subject, log=log)
    log(f"research-design 完了: {subject} → {r['count']}形式")


def cmd_goals_audit() -> None:
    """全コンテンツが最終ゴール(卒業6能力)に貢献しているか監査する。"""
    from .content.goals import audit
    a = audit()
    log(f"=== ゴール貢献度監査 ===  整合率 {a['alignment_pct']}%（{a['aligned_items']}/{a['total_items']}）")
    log(f"ミッション: {a['mission']}")
    log("能力別カバレッジ:")
    names = {c["id"]: c["name"] for c in a["competencies"]}
    for gid, n in a["competency_coverage"].items():
        log(f"  {gid} {names.get(gid,'')}: {n}件")
    if a["flagged"]:
        log(f"⚠️ 要対応 {len(a['flagged'])}件:")
        for x in a["flagged"][:50]:
            log(f"  [{x['kind']}] {x['id']} — {x['reason']} (hits={x['hits']})")
    else:
        log("✅ 非貢献コンテンツはありません。")
    rep = ROOT / "data" / "reports" / "goals_audit.md"
    rep.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"# ゴール貢献度監査  整合率 {a['alignment_pct']}%", "",
             f"> {a['mission']}", "", "## 能力別カバレッジ"]
    lines += [f"- {gid} {names.get(gid,'')}: {n}件" for gid, n in a["competency_coverage"].items()]
    lines += ["", "## 要対応（非貢献 or 必須未充足）"]
    lines += ([f"- [{x['kind']}] {x['id']} — {x['reason']}（hits={x['hits']}）" for x in a["flagged"]]
              or ["- なし ✅"])
    rep.write_text("\n".join(lines), encoding="utf-8")
    log(f"  レポート: {rep}")


def cmd_beginner_course() -> None:
    """初心者向け3レベル学習コース(平易化・図解前提・ゲーム用)を生成。"""
    from .content.beginner import write_course_files
    write_course_files(log=log)
    log("  ブラウザ版ゲーム: python -m src.pipeline dashboard → http://127.0.0.1:8765/game")


def cmd_content_list() -> None:
    from .content.generator import load_templates, list_formats
    specs = load_templates()
    log("=== 生成可能な形式（テンプレート） ===")
    for fmt, label, aliases in list_formats(specs):
        log(f"  {fmt:20s} {label:16s} 別名: {', '.join(aliases)}")
    log("使い方: python -m src.pipeline generate <format|別名> \"<主題>\"")


def cmd_review(source_filter: str = "") -> None:
    """
    生成済みクイズを10観点(各10点/合計100点)で再評価し、
    - 総合 >= 85 かつ 重大問題なし → 公開候補として data/quizzes/review_candidates.md に保存
    - 総合 < 85 → 要修正としてログに列挙（承認しない）
    - 重大問題(出典不足/エビデンスD/正解の曖昧さ/QA不可) → rejected 判定をログに列挙
    approve は行わない。
    """
    db = _db()
    verified = db.get_verified_claims()
    verified_ids = {c["claim_id"] for c in verified}
    claims_by_id = {c["claim_id"]: c for c in verified}
    db.close()

    qsrc = P["quiz_drafts"].parent / "quiz_source.json"
    defs = json.loads(qsrc.read_text(encoding="utf-8"))
    sources = {s["source_id"]: s for s in json.loads(P["sources_json"].read_text(encoding="utf-8"))}

    if source_filter:
        defs = [d for d in defs if source_filter in d.get("source_ids", [])]

    candidates: list[tuple[Quiz, object]] = []
    to_fix: list[str] = []
    to_reject: list[str] = []
    for d in defs:
        q = Quiz.from_dict(d)
        card = evaluate_quiz(q, verified_ids, claims_by_id)
        if card.verdict == "reject":
            to_reject.append(f"{q.quiz_id} (総合{card.total}) {card.issues}")
        elif card.verdict == "fix":
            to_fix.append(f"{q.quiz_id} (総合{card.total}) {card.issues}")
        else:
            candidates.append((q, card))

    md = _render_review_md(candidates, sources, claims_by_id)
    out = P["quiz_drafts"].parent / "review_candidates.md"
    out.write_text(md, encoding="utf-8")
    log(f"review 完了: 公開候補 {len(candidates)} / 要修正 {len(to_fix)} / 却下 {len(to_reject)}")
    for x in to_fix:
        log(f"  要修正: {x}")
    for x in to_reject:
        log(f"  却下: {x}")
    log(f"  → 公開候補は {out} に保存（approveは未実行）")


def _render_review_md(candidates, sources, claims_by_id) -> str:
    from .validation.evaluate import EvalCard  # noqa
    DIM_JP = {
        "medical_accuracy": "医学的正確性", "clarity": "分かりやすさ",
        "single_answer": "正解一意", "choice_naturalness": "選択肢の自然さ",
        "explanation_value": "解説の教育的価値", "traceability": "出典追跡性",
        "male_education_fit": "男性向け適切さ", "no_generalization": "一括りにしない",
        "not_technique_biased": "テクニック非偏重", "consent_communication": "同意・対話",
    }
    lines = [
        "# 公開候補クイズ（レビュー用・未承認）",
        "",
        f"- 生成日時: {_now()}",
        f"- 公開候補数: {len(candidates)} 問（各10観点/100点で85点以上・重大問題なし）",
        "- ※ approve は未実行。人間の最終確認後に `python -m src.pipeline approve <id>` で承認してください。",
        "",
        "---",
        "",
    ]
    for q, card in candidates:
        src = sources.get(q.source_ids[0], {}) if q.source_ids else {}
        ts = " / ".join(f"{cid}:{claims_by_id.get(cid,{}).get('timestamp','?')}" for cid in q.claim_ids)
        lines += [
            f"## {q.quiz_id}  第{q.chapter}章 / Level {q.level}  （総合 {card.total}/100）",
            "",
            f"**1. 問題文**：{q.question}",
            "",
            "**2. 選択肢**",
            *[f"- {k}：{q.choices[k]}" + ("　◀正解" if k == q.correct_answer else "") for k in "ABCD"],
            "",
            f"**3. 正解**：{q.correct_answer}",
            "",
            f"**4. 正解の解説**：{q.choice_explanations[q.correct_answer]}",
            "",
            "**5. 各不正解が誤りである理由**",
            *[f"- {k}：{q.choice_explanations[k]}" for k in "ABCD" if k != q.correct_answer],
            "",
            f"**6. 解剖・生理の解説**：{q.explanation}",
            "",
            f"**7. 出典**：source_ids={q.source_ids} / claim_ids={q.claim_ids}",
            f"**8. 動画タイトル**：{src.get('title','?')}",
            f"**9. YouTube URL**：{src.get('youtube_url','?')}",
            f"**10. 該当タイムスタンプ**：{ts}",
            f"**11. エビデンスレベル**：{q.evidence_level}",
            f"**12. 要検証事項**：{q.needs_verification or 'なし'}",
            f"**13. 個人差の注意**：{q.individual_variation_note or '—'}",
            f"**　　同意・安全の注意**：{q.consent_note or '—'}",
            f"**　　日常/対話への応用**：{q.practical_point or '—'}",
            "",
            "**評価（10観点／各10点）**",
            "",
            "| " + " | ".join(DIM_JP[k] for k in DIM_JP) + " | 合計 |",
            "|" + "---|" * (len(DIM_JP) + 1),
            "| " + " | ".join(f"{card.dims[k]:.1f}" for k in DIM_JP) + f" | **{card.total:.1f}** |",
            "",
            "---",
            "",
        ]
    return "\n".join(lines)


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
    "review": cmd_review,
    "kb-build": cmd_kb_build,
    "kb-stats": cmd_kb_stats,
    "content-list": cmd_content_list,
    "beginner-course": cmd_beginner_course,
    "goals-audit": cmd_goals_audit,
    "research": cmd_research,
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
    if cmd == "review":
        cmd_review(argv[1] if len(argv) > 1 else ""); return 0
    if cmd == "kb-generate":
        ev = argv[1] if len(argv) > 1 else "A"
        topic = argv[2] if len(argv) > 2 else ""
        cmd_kb_generate(ev, topic); return 0
    if cmd == "generate":
        if len(argv) < 3:
            print('usage: generate <format> "<subject>"  （例: generate instagram "陰部神経"）')
            return 1
        cmd_generate(argv[1], argv[2]); return 0
    if cmd == "content-all":
        if len(argv) < 2:
            print('usage: content-all "<subject>"'); return 1
        cmd_content_all(argv[1]); return 0
    if cmd == "dashboard":
        from .dashboard.server import serve
        serve(int(argv[1]) if len(argv) > 1 else 8765); return 0
    if cmd == "research-design":
        if len(argv) < 2:
            print('usage: research-design "<subject>"'); return 1
        cmd_research_design(argv[1]); return 0
    fn = COMMANDS.get(cmd)
    if not fn:
        print(f"unknown command: {cmd}\n"); print(__doc__); return 1
    fn()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
