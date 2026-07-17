"""
Content Generator: Knowledge Base を唯一の情報源として、同じ知識から
複数形式の教育コンテンツを生成するエンジン。

構造:
  templates/content/*.json (テンプレ仕様) を読み込み
     → alias で format 解決（例 "instagram" → instagram_carousel）
     → KB から KnowledgeBundle を構築（KBのみ参照＝SSoT）
     → archetype レンダラで Markdown 生成
     → data/content/<subject>/<format>.md に保存

KBを更新して再実行すれば、全コンテンツが最新のKB状態から作り直される
（生成は KB の純粋な関数。出力ヘッダに kb_version を刻む）。
"""
from __future__ import annotations

import json
from pathlib import Path

from ..kb.store import KB
from ..kb.bundle import build_bundle
from .renderers import ARCHETYPES

ROOT = Path(__file__).resolve().parent.parent.parent
TEMPLATE_DIR = ROOT / "templates" / "content"
OUT_DIR = ROOT / "data" / "content"


def load_templates() -> dict[str, dict]:
    """format名 -> spec。エイリアスも同じ spec を指すよう展開。"""
    specs: dict[str, dict] = {}
    for f in sorted(TEMPLATE_DIR.glob("*.json")):
        spec = json.loads(f.read_text(encoding="utf-8"))
        specs[spec["format"]] = spec
    return specs


def resolve_format(name: str, specs: dict[str, dict]) -> dict | None:
    if name in specs:
        return specs[name]
    for spec in specs.values():
        if name in spec.get("aliases", []) or name == spec["format"]:
            return spec
    return None


def list_formats(specs: dict[str, dict]) -> list[tuple[str, str, list[str]]]:
    return [(s["format"], s.get("label", ""), s.get("aliases", [])) for s in specs.values()]


def _safe_dir(name: str) -> str:
    return "".join(c if c.isalnum() or c in "＿_-" else "_" for c in name)[:40]


def generate_content(kb_path: Path, fmt: str, subject: str, log=print) -> Path | None:
    specs = load_templates()
    spec = resolve_format(fmt, specs)
    if not spec:
        log(f"未知の形式: {fmt}. `content-list` で一覧を確認してください。")
        return None

    kb = KB(kb_path)
    try:
        # quiz はグラフ生成器に委譲（KB由来・4種の4択部分）
        if spec["archetype"] == "quiz":
            from ..kb.generate_kb import generate
            b = build_bundle(kb, subject, min_evidence=spec.get("min_evidence", "A"))
            topic_id = b.subject_id if b.subject_kind == "topic" else \
                (kb.get_entity(b.subject_id) or {}).get("topic_id")
            quizzes = generate(kb, min_evidence=spec.get("min_evidence", "A"), topic_id=topic_id)
            md = _render_quiz_md(b.display_name, quizzes)
        else:
            b = build_bundle(kb, subject, min_evidence=spec.get("min_evidence", "B"))
            if not b.facts:
                log(f"注意: 主題『{subject}』に該当する検証済み知識が見つかりません（Evidence条件を満たすclaim無し）。")
            renderer = ARCHETYPES[spec["archetype"]]
            md = renderer(b, spec)
    except ValueError as e:
        log(str(e))
        kb.close()
        return None
    kb.close()

    subdir = OUT_DIR / _safe_dir(subject)
    subdir.mkdir(parents=True, exist_ok=True)
    out = subdir / f"{spec['format']}.md"
    out.write_text(md, encoding="utf-8")
    log(f"生成: {spec.get('label', spec['format'])} → {out}")
    return out


def generate_all(kb_path: Path, subject: str, log=print) -> list[Path]:
    specs = load_templates()
    outs = []
    for spec in specs.values():
        p = generate_content(kb_path, spec["format"], subject, log=log)
        if p:
            outs.append(p)
    return outs


def _render_quiz_md(subject: str, quizzes: list[dict]) -> str:
    L = [f"<!-- generated_from: Knowledge Base -->",
         f"# 4択クイズ：{subject}（Evidence Aのみ・KB生成）", ""]
    for q in quizzes:
        L += [f"## {q['quiz_id']} [{q['quiz_type']}] Evidence {q['evidence_level']}",
              f"- 問題: {q['question']}",
              *[f"  - {k}: {q['choices'][k]}" + ("　◀正解" if k == q['correct_answer'] else "")
                for k in "ABCD"],
              f"- 解説: {q['explanation']}",
              f"- 出典: {q.get('source_ids', [])}", ""]
    if not quizzes:
        L.append("_該当テーマで Evidence A のグラフが不足しています。_")
    return "\n".join(L)
