"""
ナレッジグラフ駆動のクイズ自動生成。

グラフのエッジ(関係)とパス(多段)から、4種類の問題を生成する:
  - fill_blank        穴埋め（空欄に入る語を選ぶ）
  - multiple_choice   4択
  - application       応用（多段の関係をたどる）
  - case              ケース（臨床エンティティを用いた場面設定）

Evidence フィルタ: min_evidence 以上のエッジ/パスのみを使う（例: "A" で Evidence A 限定）。
生成物は schemas.Quiz 互換の dict で、既存の QA / 採点 / 承認フローにそのまま流せる。
すべて review_status="draft"（人間の確認前）で出力する。
"""
from __future__ import annotations

from .store import KB
from .graph import find_paths, path_evidence, chain_label

# 関係ごとの穴埋め/4択テンプレート。
# fill: 設問文（{X}=from名, 空欄=to）, answer_type=正解エンティティのetype
RELATION_TEMPLATES = {
    "branch_of":       {"q": "{X}は【　】の枝である。", "atype": "nerve", "ch": 3},
    "innervated_by":   {"q": "{X}の感覚を主に伝える神経は【　】である。", "atype": "nerve", "ch": 3},
    "originates_from": {"q": "{X}が由来する脊髄分節は【　】である。", "atype": "spinal_segment", "ch": 3},
    "autonomic_type":  {"q": "{X}は自律神経のうち【　】に分類される。", "atype": "autonomic", "ch": 3},
    "homolog_of":      {"q": "{X}と発生学的に相同な男性器は【　】である。", "atype": "anatomy", "ch": 1},
    "responds_to":     {"q": "{X}が主に反応する刺激は【　】である。", "atype": "stimulus", "ch": 4},
    "contracts_in":    {"q": "オーガズム時に律動的に収縮するのは【　】である。", "atype": "muscle", "ch": 5},
    "associated_with": {"q": "{Y}の一因として関連が深いのは【　】である。", "atype": "clinical", "ch": 8},
}

# エンティティが足りない時の妥当な誤答プール（etype別）
DISTRACTOR_POOL = {
    "nerve": ["迷走神経", "坐骨神経", "横隔神経", "大腿神経"],
    "spinal_segment": ["L1〜L2", "T11〜L2", "C5〜T1"],
    "autonomic": ["体性運動神経", "体性感覚神経"],
    "stimulus": ["温度刺激", "侵害刺激"],
    "anatomy": ["精巣", "尿管", "膀胱"],
    "muscle": ["大腿四頭筋", "上腕二頭筋", "三角筋"],
    "clinical": ["尿路感染症", "月経困難症"],
}

TOPIC_CHAPTER = {
    "TOP-external": 1, "TOP-internal": 1, "TOP-innervation": 3, "TOP-receptor": 4,
    "TOP-pelvicfloor": 5, "TOP-response": 6,
}


def _name(kb: KB, eid: str) -> str:
    e = kb.get_entity(eid)
    return e["name"] if e else eid


def _source_ids_for_claims(kb: KB, claim_ids: list[str]) -> list[str]:
    out: list[str] = []
    for cid in claim_ids:
        for s in kb.sources_for_claim(cid):
            if s["source_id"] not in out:
                out.append(s["source_id"])
    return out


def _distractors(kb: KB, answer_name: str, atype: str, exclude: set[str], n: int = 3) -> list[str]:
    cands: list[str] = []
    for e in sorted(kb.entities_by_type(atype), key=lambda x: x["name"]):
        if e["name"] != answer_name and e["name"] not in exclude:
            cands.append(e["name"])
    for p in DISTRACTOR_POOL.get(atype, []):
        if p != answer_name and p not in exclude and p not in cands:
            cands.append(p)
    return cands[:n]


def _assemble(quiz_id, quiz_type, chapter, level, question, choices, correct,
              explanation, evidence, claim_ids, source_ids, extra=None):
    ce = {}
    for k, v in choices.items():
        ce[k] = "正しい。" + explanation[:40] if k == correct else "この関係にはあてはまりません。"
    q = {
        "quiz_id": quiz_id, "quiz_type": quiz_type, "chapter": chapter, "level": level,
        "question": question, "choices": choices, "correct_answer": correct,
        "explanation": explanation, "choice_explanations": ce,
        "practical_point": "知識同士のつながり(グラフ)で理解すると記憶に残りやすい。",
        "individual_variation_note": "解剖・神経の基本構造は共通だが、感受性や反応には個人差がある。",
        "consent_note": "身体の理解は、パートナーとの対話と同意を尊重するための土台として用いる。"
        if chapter in (6, 7, 8, 9) else "",
        "source_ids": source_ids, "claim_ids": claim_ids,
        "evidence_level": evidence, "needs_verification": "グラフ自動生成。人間の医学的確認前(draft)。",
        "review_status": "draft",
    }
    if extra:
        q.update(extra)
    return q


def _choices_from(answer: str, distractors: list[str], slot: int) -> tuple[dict, str]:
    """answer と distractor から A-D を作る。slot で正解位置を分散。"""
    opts = distractors[:3]
    pos = slot % 4
    opts.insert(pos, answer)
    letters = "ABCD"
    choices = {letters[i]: opts[i] for i in range(4)}
    correct = letters[pos]
    return choices, correct


def generate(kb: KB, min_evidence: str = "A", topic_id: str | None = None,
             limit_per_type: int = 5) -> list[dict]:
    """Evidence>=min_evidence のグラフから4種の問題を生成して返す。"""
    quizzes: list[dict] = []
    edges = kb.all_edges(min_evidence=min_evidence, topic_id=topic_id)
    seq = [0]

    def nid(prefix):
        seq[0] += 1
        return f"KBQ-{prefix}-{seq[0]:03d}"

    # --- fill_blank & multiple_choice: 単一エッジから ---
    fb = mc = 0
    for e in edges:
        tmpl = RELATION_TEMPLATES.get(e["relation"])
        if not tmpl:
            continue
        x = _name(kb, e["from_entity"])
        y = _name(kb, e["to_entity"])
        answer = y
        q_text = tmpl["q"].replace("{X}", x).replace("{Y}", y)
        chapter = tmpl["ch"]
        claim_ids = e.get("claim_ids", [])
        if isinstance(claim_ids, str):
            import json
            claim_ids = json.loads(claim_ids)
        source_ids = _source_ids_for_claims(kb, claim_ids)
        expl = f"{x}—({e['relation']})→{y}。{e.get('note','')}".strip("。") + "。"

        # 穴埋め
        if fb < limit_per_type:
            dist = _distractors(kb, answer, tmpl["atype"], exclude={x})
            if len(dist) >= 3:
                choices, correct = _choices_from(answer, dist, slot=fb)
                quizzes.append(_assemble(
                    nid("FB"), "fill_blank", chapter, 1, q_text, choices, correct,
                    expl, e["evidence_level"], claim_ids, source_ids))
                fb += 1
        # 4択（穴埋めと別スロットで正解位置を変える）
        if mc < limit_per_type:
            dist = _distractors(kb, answer, tmpl["atype"], exclude={x})
            if len(dist) >= 3:
                q2 = q_text.replace("【　】", "何")  # 4択は疑問形に
                q2 = f"{x}について、{tmpl['q'].replace('{X}','').replace('{Y}','').replace('【　】','正しいもの').strip()}"
                # シンプルに元の穴埋め文＋「正しいものを選べ」
                q2 = q_text + "（正しいものを選べ）"
                choices, correct = _choices_from(answer, dist, slot=mc + 1)
                quizzes.append(_assemble(
                    nid("MC"), "multiple_choice", chapter, 2, q2, choices, correct,
                    expl, e["evidence_level"], claim_ids, source_ids))
                mc += 1

    # --- application: 2ホップ以上のパスから ---
    app = 0
    starts = ["ENT-clitoris-glans", "ENT-clitoris", "ENT-pelvic-splanchnic"]
    for start in starts:
        if app >= limit_per_type:
            break
        for path in find_paths(kb, start, max_hops=3, min_evidence=min_evidence):
            if len(path) < 2:
                continue
            end = path[-1]["to_entity"]
            atype = kb.get_entity(end)["etype"] if kb.get_entity(end) else "nerve"
            answer = _name(kb, end)
            startname = _name(kb, start)
            q_text = (f"{startname}から関係をたどると、最終的に行き着くのは【　】である。"
                      f"（経路: {chain_label(kb, path)}）")
            claim_ids = []
            for e in path:
                cids = e.get("claim_ids", [])
                if isinstance(cids, str):
                    import json
                    cids = json.loads(cids)
                claim_ids += cids
            claim_ids = list(dict.fromkeys(claim_ids))
            source_ids = _source_ids_for_claims(kb, claim_ids)
            dist = _distractors(kb, answer, atype, exclude={startname})
            if len(dist) < 3:
                continue
            choices, correct = _choices_from(answer, dist, slot=app)
            expl = "経路をたどると " + chain_label(kb, path) + f" となり、答えは{answer}。"
            quizzes.append(_assemble(
                nid("AP"), "application", TOPIC_CHAPTER.get(
                    kb.get_entity(start).get("topic_id"), 3), 3,
                q_text, choices, correct, expl, path_evidence(path),
                claim_ids, source_ids))
            app += 1
            if app >= limit_per_type:
                break

    # --- case: 臨床エンティティ(associated_with)から場面設定 ---
    cs = 0
    for e in edges:
        if e["relation"] != "associated_with" or cs >= limit_per_type:
            continue
        clinical = _name(kb, e["to_entity"])
        cause = _name(kb, e["from_entity"])
        claim_ids = e.get("claim_ids", [])
        if isinstance(claim_ids, str):
            import json
            claim_ids = json.loads(claim_ids)
        source_ids = _source_ids_for_claims(kb, claim_ids)
        q_text = (f"あるケース: {clinical}の訴えがある。解剖・生理の観点で、"
                  f"関連する要因として最も考えられるのは【　】である。")
        dist = _distractors(kb, cause, kb.get_entity(e["from_entity"])["etype"], exclude={clinical})
        if len(dist) < 3:
            continue
        choices, correct = _choices_from(cause, dist, slot=cs + 2)
        expl = f"{cause}は{clinical}に関連しうる（{e.get('note','')}）。痛み等が続く場合は受診を勧める。"
        quizzes.append(_assemble(
            nid("CS"), "case", 8, 3, q_text, choices, correct, expl,
            e["evidence_level"], claim_ids, source_ids,
            extra={"consent_note": "症状を我慢させず、必要に応じて医療機関の受診を勧めること。"}))
        cs += 1

    return quizzes
