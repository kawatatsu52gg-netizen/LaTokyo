"""Research Team のテスト（分析・完成度・Scout・dedup・Evidence仮判定）。"""
import unittest
from pathlib import Path

from src.kb.build import build
from src.research import curriculum, team

ROOT = Path(__file__).resolve().parent.parent


class TestResearch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build(ROOT / "data" / "database" / "kb.db", log=lambda *a: None)

    def test_completeness_0_100(self):
        a = curriculum.analyze()
        self.assertGreaterEqual(a["overall_completeness"], 0)
        self.assertLessEqual(a["overall_completeness"], 100)
        self.assertTrue(a["topics"])

    def test_gaps_detects_missing_topics(self):
        g = curriculum.knowledge_gaps()
        # curriculum.json には KB未登録テーマ(更年期 等)がある
        self.assertIn("更年期", g["missing_topics"])

    def test_evidence_coverage(self):
        ec = curriculum.evidence_coverage()
        self.assertIn("ab_ratio", ec)
        self.assertGreaterEqual(ec["ab_ratio"], 0)

    def test_scout_queue_prioritizes_missing(self):
        q = team.scout()
        self.assertTrue(q)
        self.assertTrue(any(x["priority"] == "高" for x in q))

    def test_dedup_flags_existing(self):
        cands = [{"candidate_id": "X", "statement": "陰核背神経は陰部神経の終枝である。",
                  "proposed_sources": [{"reliability": "A"}]}]
        out = team.dedup(cands)
        self.assertEqual(out[0]["status"], "duplicate")

    def test_evidence_reviewer_bumps_multisource(self):
        cands = [{"candidate_id": "Y", "statement": "テスト", "proposed_sources": [
            {"reliability": "B"}, {"reliability": "A"}]}]
        out = team.review_evidence(cands)
        self.assertEqual(out[0]["tentative_evidence"], "A")
        self.assertTrue(out[0]["needs_human_verification"])


if __name__ == "__main__":
    unittest.main()
