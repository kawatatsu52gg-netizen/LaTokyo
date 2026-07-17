"""Dashboard バックエンドのスモークテスト（KB=SSoTの集計・検索が壊れていないか）。"""
import unittest
from pathlib import Path

from src.kb.build import build
from src.dashboard import stats, search

ROOT = Path(__file__).resolve().parent.parent


class TestDashboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 実データのkb.dbを構築（存在すれば再構築で冪等）
        build(ROOT / "data" / "database" / "kb.db", log=lambda *a: None)

    def test_summary_shape(self):
        s = stats.dashboard_summary()
        for k in ("today_videos", "notebooklm_pending", "unreviewed_claims",
                  "review_quizzes", "publish_pending_content", "instagram",
                  "slides", "youtube", "quality", "kb"):
            self.assertIn(k, s)
        self.assertIn("claims", s["kb"])

    def test_topics_have_metrics(self):
        t = stats.topics()
        self.assertTrue(t)
        for row in t:
            for k in ("videos", "claims", "evidence_AB", "quizzes", "instagram", "slides"):
                self.assertIn(k, row)

    def test_search_returns_groups(self):
        r = search.search("陰部神経")
        for k in ("entities", "claims", "evidence", "videos", "quizzes"):
            self.assertIn(k, r)
        self.assertTrue(r["claims"])  # 何かしら見つかる

    def test_search_empty(self):
        r = search.search("")
        self.assertEqual(r["claims"], [])


if __name__ == "__main__":
    unittest.main()
