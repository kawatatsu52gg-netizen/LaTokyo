"""
初心者向けコース生成。KB(専門)→ 自動平易化 → 3レベルのゲーム形式コンテンツ。

- 対象: 解剖学をまったく知らない一般男性
- 方針: 専門用語は最小、図解前提、1問1知識、小学生でも分かる解説、
        学習ゲームのようにレベルアップ、相手の尊重・対話を最終目標にする
- レベル: 1 身体を知る / 2 仕組みを知る / 3 相互理解を深める
"""
from __future__ import annotations

import json
from pathlib import Path

from .plain import to_plain, jargon_in

ROOT = Path(__file__).resolve().parent.parent.parent
LEVELS = ROOT / "data" / "beginner" / "levels.json"
QUIZZES = ROOT / "data" / "quizzes"
OUT = ROOT / "data" / "content" / "beginner"

FIGURE_BY_CHAPTER = {
    1: "外から見える部分を、外側→内側の順にやさしく色分けしたイラスト。",
    2: "クリトリスは見えるのは一部で、体の中に広がっていることを『氷山』でたとえた図。",
    3: "『さわった感じ』が神経を通って脳にとどくまでを矢印で示す図。",
    4: "皮ふにある『感じるセンサー』の種類を、かわいいアイコンで並べた図。",
    5: "息を吸う・はくと、下の筋肉がやさしく動くことを示す図。",
    6: "リラックスすると血が集まってうるおう、という流れの図。",
    7: "気持ちよさは『脳』と『体』が合わさって起こることを示す図。",
    8: "痛みは信号機の『赤（ストップ）』。がまんしないことを示す図。",
    9: "『人によってちがう』ことを、いろいろな形のグラフで示す図。",
    10: "✕まちがった思い込み → ◯正しい理解、の対比イラスト。",
}


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _levels_cfg() -> dict:
    return _load(LEVELS, {"levels": [], "pass_ratio": 0.7})


def level_of_chapter(ch: int) -> int:
    for lv in _levels_cfg()["levels"]:
        if ch in lv.get("chapters", []):
            return lv["level"]
    return 1


def _collect_kb_quizzes() -> list[dict]:
    items = []
    qs = QUIZZES / "quiz_source.json"
    if qs.exists():
        items += _load(qs, [])
    for folder in ("kb_generated", "approved", "drafts"):
        d = QUIZZES / folder
        if d.exists():
            for f in d.glob("*.json"):
                items.append(_load(f, {}))
    # quiz_id で重複排除
    seen, uniq = set(), []
    for q in items:
        qid = q.get("quiz_id")
        if qid and qid not in seen:
            seen.add(qid); uniq.append(q)
    return uniq


# 思いやる行動(ゴールG6)を必ず含めるための語
_CARE_WORDS = ("尊重", "思いやり", "相手の気持ち", "いやがる", "我慢", "無理", "受診")


def _respect_note(q: dict) -> str:
    """各問に『知識→思いやる行動』を必ず添える（学習ゴールG6を保証）。"""
    note = q.get("consent_note", "") or "大切なのは、相手の気持ちを聞いて、いやがることはしないこと。"
    if not any(w in note for w in _CARE_WORDS):
        note = note.rstrip("。") + "。相手を尊重し、いやがることはしません。"
    return note


def to_beginner_quiz(q: dict) -> dict:
    """KBクイズ1問を、初心者向け(平易・図解・尊重)に変換。1問1知識は維持。"""
    ch = q.get("chapter", 1)
    lv = level_of_chapter(ch)
    choices = {k: to_plain(v) for k, v in (q.get("choices") or {}).items()}
    return {
        "id": q.get("quiz_id"),
        "level": lv,
        "question": to_plain(q.get("question", "")),
        "choices": choices,
        "correct_answer": q.get("correct_answer"),
        "explain": to_plain(q.get("choice_explanations", {}).get(q.get("correct_answer"), "")
                            or q.get("explanation", "")),
        "figure_hint": FIGURE_BY_CHAPTER.get(ch, "関係する部分をやさしく示すイラスト。"),
        "one_point": to_plain(q.get("individual_variation_note", "")) or "人によってちがいます。",
        "respect_note": _respect_note(q),
        "source_ids": q.get("source_ids", []),
        "evidence_level": q.get("evidence_level", ""),
    }


def build_course() -> dict:
    """3レベルに平易クイズを配置したコースを返す（ゲーム用データ）。"""
    cfg = _levels_cfg()
    quizzes = [to_beginner_quiz(q) for q in _collect_kb_quizzes() if q.get("quiz_id")]
    by_level: dict[int, list[dict]] = {1: [], 2: [], 3: []}
    for bq in quizzes:
        by_level.setdefault(bq["level"], []).append(bq)
    levels = []
    for lv in cfg["levels"]:
        levels.append({
            "level": lv["level"], "title": lv["title"], "goal": lv["goal"],
            "badge": lv["badge"], "figure_theme": lv["figure_theme"],
            "communication": lv["communication"],
            "quizzes": by_level.get(lv["level"], []),
        })
    return {"pass_ratio": cfg.get("pass_ratio", 0.7), "levels": levels}


def render_level_map(course: dict) -> str:
    """レベルマップ(ゲームの全体像)を Markdown＋簡単なSVGで。"""
    L = ["<!-- generated_from: Knowledge Base（初心者向けに自動平易化） -->",
         "# 女性の身体を知る 学習ゲーム 🎮", "",
         "> 解剖学を知らなくて大丈夫。3つのレベルを、図を見ながら1問ずつ進めましょう。",
         "> ゴールは『くわしい人』ではなく『安心して話し合えるパートナー』になることです。", ""]
    # かんたんなSVGレベルマップ
    L += ["```", "レベルマップ"]
    for lv in course["levels"]:
        n = len(lv["quizzes"])
        L.append(f"  Lv{lv['level']} {lv['title']}  {lv['badge']}  （クイズ{n}問）→")
    L += ["```", ""]
    for lv in course["levels"]:
        L += [f"## Level {lv['level']}：{lv['title']}  {lv['badge']}",
              f"- ねらい: {lv['goal']}",
              f"- 図解: {lv['figure_theme']}",
              f"- 大切なこと: {lv['communication']}",
              f"- クイズ数: {len(lv['quizzes'])}（クリア条件: {int(course['pass_ratio']*100)}%正解）", ""]
        for bq in lv["quizzes"][:3]:
            L.append(f"  - 例）{bq['question']}")
        L.append("")
    L += ["---", "クリアすると次のレベルが開きます。ブラウザ版ゲーム: `/game`（`npm run dev` で起動）。"]
    return "\n".join(L)


def render_beginner_lesson(subject: str) -> str:
    """あるテーマの初心者向けレッスン（平易な事実＋図解＋やさしい一言）。"""
    from ..kb.store import KB
    from ..kb.bundle import build_bundle
    kb = KB(ROOT / "data" / "database" / "kb.db")
    try:
        b = build_bundle(kb, subject, min_evidence="B")
    except ValueError as e:
        kb.close()
        return f"# {subject}\n\n{e}"
    kb.close()
    L = ["<!-- generated_from: Knowledge Base（初心者向けに自動平易化） -->",
         f"# {subject} をやさしく知ろう", "",
         "> 専門用語はできるだけ使いません。図を見ながら、1つずつ。", "",
         "## わかりやすいポイント"]
    for f in b.facts[:6]:
        L.append(f"- {to_plain(f.text)}")
    L += ["", "## 図解のヒント",
          "- 名前や場所は、絵にすると一気に分かりやすくなります（外側→内側の順など）。", "",
          "## 覚えておきたいこと",
          "- 人によってちがいます。『みんな同じ』ではありません。",
          "- 大切なのは、相手の気持ちを聞くこと・いやがることはしないこと。",
          "- 痛みや不安があるときは、無理せずお医者さんに相談を。"]
    return "\n".join(L)


def write_course_files(log=print) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    course = build_course()
    (OUT / "level_map.md").write_text(render_level_map(course), encoding="utf-8")
    (OUT / "course.json").write_text(json.dumps(course, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = {lv["level"]: len(lv["quizzes"]) for lv in course["levels"]}
    log(f"beginner-course 生成: レベル別クイズ {counts} → {OUT}/")
    return {"counts": counts, "path": str(OUT)}
