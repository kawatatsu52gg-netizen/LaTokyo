"""
ナレッジグラフ探索とEvidence統合。

- neighbors: あるエンティティから relation でたどれる隣接ノード
- paths: 多段(マルチホップ)のパス探索（応用問題の材料）
- Evidence統合: エッジ/claimのエビデンスを合成して経路全体の強さを出す
"""
from __future__ import annotations

from .store import KB, evidence_min, evidence_at_least


def neighbors(kb: KB, entity_id: str, relation: str | None = None,
              min_evidence: str | None = None) -> list[dict]:
    """entity から出るエッジ（relation/エビデンスで絞り込み可）。"""
    return kb.edges_from(entity_id, relation=relation, min_evidence=min_evidence)


def find_paths(kb: KB, start: str, max_hops: int = 3,
               min_evidence: str | None = None,
               relations: list[str] | None = None) -> list[list[dict]]:
    """
    start から最大 max_hops のパスを列挙（DFS、サイクル回避）。
    各パスは edge dict のリスト。応用/多段問題の素材になる。
    """
    paths: list[list[dict]] = []

    def dfs(node: str, trail: list[dict], visited: set[str]):
        if len(trail) >= max_hops:
            return
        for e in kb.edges_from(node, min_evidence=min_evidence):
            if relations and e["relation"] not in relations:
                continue
            if e["to_entity"] in visited:
                continue
            new_trail = trail + [e]
            paths.append(new_trail)
            dfs(e["to_entity"], new_trail, visited | {e["to_entity"]})

    dfs(start, [], {start})
    return paths


def path_evidence(path: list[dict]) -> str:
    """パス全体のエビデンス = 構成エッジの最小（最も弱いリンクに律速）。"""
    return evidence_min([e["evidence_level"] for e in path])


def integrated_evidence(kb: KB, claim_id: str) -> str:
    """
    Evidence統合: 1つの主張を支持する複数ソースから統合エビデンスを推定。
    - ソースが1つ: そのソース評価
    - 複数ソースが一致: 最も強いソース評価を上限に、+1段引き上げ（上限A）
    実際の最終値は claims.evidence_level（Reviewer確定）を優先し、参考値として返す。
    """
    srcs = kb.sources_for_claim(claim_id)
    if not srcs:
        return "D"
    levels = [s["source_evidence"] for s in srcs]
    base = max(levels, key=lambda l: {"A": 3, "B": 2, "C": 1, "D": 0}.get(l, 0))
    if len(srcs) >= 2:
        bump = {"D": "C", "C": "B", "B": "A", "A": "A"}
        return bump.get(base, base)
    return base


def chain_label(kb: KB, path: list[dict]) -> str:
    """パスを『陰核 →(innervated_by) 陰核背神経 →…』の形で文字列化。"""
    if not path:
        return ""
    parts = [_name(kb, path[0]["from_entity"])]
    for e in path:
        parts.append(f"→({e['relation']}) {_name(kb, e['to_entity'])}")
    return " ".join(parts)


def _name(kb: KB, entity_id: str) -> str:
    ent = kb.get_entity(entity_id)
    return ent["name"] if ent else entity_id
