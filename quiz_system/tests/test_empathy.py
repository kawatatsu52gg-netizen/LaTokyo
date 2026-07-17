"""Empathy（感情・相手理解）モジュールのテスト。"""
import unittest
from pathlib import Path

from src.kb.build import build
from src.content import empathy

ROOT = Path(__file__).resolve().parent.parent


class TestEmpathy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build(ROOT / "data" / "database" / "kb.db", log=lambda *a: None)

    def test_seven_sections(self):
        m = empathy.build_module("陰核")
        for k in ("body_knowledge", "why_it_matters", "partner_feelings",
                  "comm_example", "common_mistakes", "better_conversation", "lesson"):
            self.assertIn(k, m)
        self.assertTrue(m["why_it_matters"])
        self.assertTrue(m["partner_feelings"])
        self.assertTrue(m["lesson"])

    def test_body_knowledge_from_kb_plain(self):
        m = empathy.build_module("陰核")
        self.assertTrue(m["body_knowledge"])
        # 平易化されている（専門語「陰核背神経」等が残っていない）
        joined = " ".join(m["body_knowledge"])
        self.assertNotIn("陰核背神経", joined)

    def test_category_resolution(self):
        self.assertEqual(empathy.build_module("性交痛")["category"], "pain")
        self.assertEqual(empathy.build_module("オーガズム")["category"], "orgasm")

    def test_render_markdown_has_flow(self):
        md = empathy.render_markdown(empathy.build_module("陰核"))
        for h in ["身体の知識", "なぜそれが大切", "どんな気持ち", "コミュニケーション例",
                  "よくある失敗", "より良い会話例", "学び"]:
            self.assertIn(h, md)


if __name__ == "__main__":
    unittest.main()
