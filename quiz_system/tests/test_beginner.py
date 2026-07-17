"""初心者向け層のテスト（平易化・3レベルコース・ゲームデータ）。"""
import unittest
from pathlib import Path

from src.kb.build import build
from src.content import plain, beginner

ROOT = Path(__file__).resolve().parent.parent


class TestPlain(unittest.TestCase):
    def test_replaces_jargon(self):
        p = plain.to_plain("陰部神経は仙骨神経叢に由来する。")
        self.assertNotIn("陰部神経", p)
        self.assertNotIn("仙骨神経叢", p)
        self.assertIn("神経", p)  # やさしい語には残る

    def test_collapses_duplicate_parens(self):
        # 性交痛(ディスパレウニア) → 同じ平易語になり重複が畳まれる
        p = plain.to_plain("性交痛(ディスパレウニア)")
        self.assertNotIn("(", p)
        self.assertIn("痛み", p)

    def test_jargon_detector(self):
        self.assertTrue(plain.jargon_in("陰核背神経"))
        self.assertFalse(plain.jargon_in("下からささえる筋肉"))


class TestBeginner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build(ROOT / "data" / "database" / "kb.db", log=lambda *a: None)

    def test_level_mapping(self):
        self.assertEqual(beginner.level_of_chapter(1), 1)   # 身体を知る
        self.assertEqual(beginner.level_of_chapter(3), 2)   # 仕組みを知る
        self.assertEqual(beginner.level_of_chapter(9), 3)   # 相互理解

    def test_course_three_levels(self):
        course = beginner.build_course()
        self.assertEqual([l["level"] for l in course["levels"]], [1, 2, 3])
        self.assertTrue(all("badge" in l and "communication" in l for l in course["levels"]))

    def test_beginner_quiz_fields(self):
        course = beginner.build_course()
        total = 0
        for lv in course["levels"]:
            for q in lv["quizzes"]:
                total += 1
                for k in ("question", "choices", "correct_answer", "explain",
                          "figure_hint", "one_point", "respect_note", "level"):
                    self.assertIn(k, q)
        self.assertGreater(total, 0)


if __name__ == "__main__":
    unittest.main()
