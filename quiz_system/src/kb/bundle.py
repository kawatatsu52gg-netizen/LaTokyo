"""
KnowledgeBundle: Knowledge Base から「主題(subject)の知識束」を取り出す。

このモジュールは **Knowledge Base(kb.db) だけ** を参照する。
NotebookLM / YouTube / inbox の生データには一切アクセスしない。
= Single Source of Truth を保証するための唯一の読み取り口。

主題は topic 名 か entity 名/別名 で指定する。取り出すもの:
  - facts: verified な claim（statement / evidence / 出典）と、グラフのエッジ由来の関係文
  - sources: facts を支える情報源（動画/論文/教科書、locator付き）を重複排除
  - evidence_summary: 使用エビデンスの内訳
  - safety_notes: 安全・同意・個人差の定型注記（章横断で必須）
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .store import KB, evidence_at_least, evidence_max

# エッジ関係→自然文テンプレート
RELATION_SENTENCE = {
    "innervated_by": "{a}の感覚は主に{b}が伝える",
    "branch_of": "{a}は{b}の枝である",
    "originates_from": "{a}は{b}に由来する",
    "autonomic_type": "{a}は自律神経の{b}に分類される",
    "homolog_of": "{a}は発生学的に{b}と相同である",
    "responds_to": "{a}は主に{b}に反応する",
    "contracts_in": "{a}は{b}に関与して律動的に収縮する",
    "associated_with": "{a}は{b}に関連する",
    "part_of": "{b}は{a}の構成要素である",
}

SAFETY_NOTES = [
    "女性の身体には大きな個人差があり、感じ方や反応を一律には語れません。",
    "パートナーとの対話・同意・相互尊重を前提とした教育目的の情報です。",
    "痛み・出血・持続する不快感などがある場合は我慢せず、医療機関に相談してください。",
    "本内容は診断・治療ではなく、医学教育を目的としています。",
]


@dataclass
class Fact:
    text: str
    evidence: str
    source_ids: list[str] = field(default_factory=list)
    locators: list[str] = field(default_factory=list)
    kind: str = "claim"       # claim | graph


@dataclass
class Bundle:
    subject: str
    subject_kind: str          # topic | entity
    subject_id: str
    display_name: str
    facts: list[Fact] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    evidence_summary: str = ""
    related: dict[str, list[str]] = field(default_factory=dict)  # etype -> [name]
    safety_notes: list[str] = field(default_factory=lambda: list(SAFETY_NOTES))
    kb_version: str = ""

    @property
    def top_evidence(self) -> str:
        return evidence_max([f.evidence for f in self.facts]) if self.facts else "D"


def _descendant_topics(kb: KB, topic_id: str) -> list[str]:
    out = [topic_id]
    rows = kb.conn.execute(
        "SELECT topic_id FROM topics WHERE parent_topic_id=?", (topic_id,)).fetchall()
    for r in rows:
        out.extend(_descendant_topics(kb, r["topic_id"]))
    return out


def _resolve(kb: KB, subject: str) -> tuple[str, str, str]:
    """subject を topic か entity に解決。(kind, id, display_name)。"""
    row = kb.conn.execute("SELECT topic_id,name FROM topics WHERE name=?", (subject,)).fetchone()
    if row:
        return "topic", row["topic_id"], row["name"]
    # topic_id直指定も許可
    row = kb.conn.execute("SELECT topic_id,name FROM topics WHERE topic_id=?", (subject,)).fetchone()
    if row:
        return "topic", row["topic_id"], row["name"]
    eid = kb.resolve_entity(subject)
    if eid:
        ent = kb.get_entity(eid)
        return "entity", eid, ent["name"]
    raise ValueError(f"主題『{subject}』は Knowledge Base に見つかりません（topic名 か entity名/別名で指定）")


def _claim_row(kb: KB, claim_id: str) -> dict | None:
    return kb.get_claim(claim_id)


def build_bundle(kb: KB, subject: str, min_evidence: str = "B", max_facts: int = 12) -> Bundle:
    kind, sid, name = _resolve(kb, subject)
    b = Bundle(subject=subject, subject_kind=kind, subject_id=sid, display_name=name)
    b.kb_version = str(kb.conn.execute(
        "SELECT COUNT(*) FROM claims").fetchone()[0]) + "c/" + str(
        kb.conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]) + "e"

    seen_claims: set[str] = set()
    claim_ids: list[str] = []

    if kind == "topic":
        topics = _descendant_topics(kb, sid)
        qmarks = ",".join("?" * len(topics))
        rows = kb.conn.execute(
            f"""SELECT claim_id FROM claims
                WHERE topic_id IN ({qmarks}) AND verification_status='verified'""",
            topics).fetchall()
        claim_ids = [r["claim_id"] for r in rows]
        # 関連エンティティ（構成把握）
        erows = kb.conn.execute(
            f"SELECT etype,name FROM entities WHERE topic_id IN ({qmarks})", topics).fetchall()
        for er in erows:
            b.related.setdefault(er["etype"], []).append(er["name"])
    else:
        rows = kb.conn.execute(
            """SELECT c.claim_id FROM claims c
               JOIN claim_entities ce ON ce.claim_id=c.claim_id
               WHERE ce.entity_id=? AND c.verification_status='verified'""",
            (sid,)).fetchall()
        claim_ids = [r["claim_id"] for r in rows]

    # claims → facts
    for cid in claim_ids:
        if cid in seen_claims:
            continue
        seen_claims.add(cid)
        c = _claim_row(kb, cid)
        if not c or not evidence_at_least(c["evidence_level"], min_evidence):
            continue
        srcs = kb.sources_for_claim(cid)
        b.facts.append(Fact(
            text=c["statement"], evidence=c["evidence_level"],
            source_ids=[s["source_id"] for s in srcs],
            locators=[f"{s['source_id']}:{s['locator']}" for s in srcs if s["locator"]],
            kind="claim"))

    # entity主題ならグラフ関係文も facts に追加
    # ただし、既存の claim が同じ2エンティティを扱っている場合は重複回避のため足さない。
    if kind == "entity":
        claim_texts = [f.text for f in b.facts]

        def covered(a_name: str, z_name: str) -> bool:
            return any(a_name in t and z_name in t for t in claim_texts)

        cand_edges = list(kb.edges_from(sid, min_evidence=min_evidence))
        ins = kb.conn.execute("SELECT * FROM edges WHERE to_entity=?", (sid,)).fetchall()
        cand_edges += [dict(e) for e in ins if evidence_at_least(e["evidence_level"], min_evidence)]
        for e in cand_edges:
            an = (kb.get_entity(e["from_entity"]) or {}).get("name", "")
            zn = (kb.get_entity(e["to_entity"]) or {}).get("name", "")
            if covered(an, zn):
                continue
            b.facts.append(_edge_fact(kb, e))

    # facts制限・重複排除
    uniq: list[Fact] = []
    seen_txt: set[str] = set()
    for f in b.facts:
        key = f.text[:40]
        if key in seen_txt:
            continue
        seen_txt.add(key)
        uniq.append(f)
    b.facts = uniq[:max_facts]

    # sources 収集
    src_ids: list[str] = []
    for f in b.facts:
        for s in f.source_ids:
            if s not in src_ids:
                src_ids.append(s)
    for s in src_ids:
        row = kb.conn.execute("SELECT * FROM sources WHERE source_id=?", (s,)).fetchone()
        if row:
            b.sources.append(dict(row))

    # evidence内訳
    from collections import Counter
    cnt = Counter(f.evidence for f in b.facts)
    b.evidence_summary = " ".join(f"{k}:{cnt[k]}" for k in ("A", "B", "C", "D") if cnt.get(k))
    return b


def _edge_fact(kb: KB, e: dict) -> Fact:
    import json
    a = kb.get_entity(e["from_entity"]) or {"name": e["from_entity"]}
    z = kb.get_entity(e["to_entity"]) or {"name": e["to_entity"]}
    tmpl = RELATION_SENTENCE.get(e["relation"], "{a}は{b}と関係する")
    text = tmpl.format(a=a["name"], b=z["name"]) + "。"
    cids = e.get("claim_ids", [])
    if isinstance(cids, str):
        cids = json.loads(cids)
    srcs: list[str] = []
    locs: list[str] = []
    for cid in cids:
        for s in kb.sources_for_claim(cid):
            if s["source_id"] not in srcs:
                srcs.append(s["source_id"])
            if s["locator"]:
                locs.append(f"{s['source_id']}:{s['locator']}")
    return Fact(text=text, evidence=e["evidence_level"], source_ids=srcs, locators=locs, kind="graph")


def source_citation(s: dict) -> str:
    """ソース1件を引用文字列に。"""
    t = s.get("source_type")
    if t == "youtube":
        return f"[動画] {s.get('title','')}（{s.get('channel_name','')}） {s.get('youtube_url','')}"
    if t == "paper":
        return f"[論文] {s.get('authors','')} 「{s.get('title','')}」 {s.get('journal','')} doi:{s.get('doi','')}"
    if t == "textbook":
        return f"[教科書] {s.get('authors','')} 『{s.get('title','')}』 {s.get('publisher','')} {s.get('edition','')}"
    return f"{s.get('title','')}"
