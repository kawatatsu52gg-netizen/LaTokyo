"""最終ゴール(卒業6能力)への貢献度監査のテスト。"""
import unittest
from pathlib import Path

from src.kb.build import build
from src.content import goals

ROOT = Path(__file__).resolve().parent.parent


class TestGoals(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build(ROOT / "data" / "database" / "kb.db", log=lambda *a: None)

    def test_six_competencies(self):
        g = goals.goals_def()
        ids = [c["id"] for c in g["graduation_competencies"]]
        self.assertEqual(ids, ["G1", "G2", "G3", "G4", "G5", "G6"])

    def test_audit_shape_and_full_alignment(self):
        a = goals.audit()
        self.assertIn("alignment_pct", a)
        self.assertIn("competency_coverage", a)
        # 現状のコンテンツは全て最低1ゴールに貢献（非貢献ゼロ）
        no_goal = [x for x in a["flagged"] if x["reason"] == "どのゴールにも触れていない"]
        self.assertEqual(no_goal, [])

    def test_detector_flags_goalless_text(self):
        comps = goals.goals_def()["graduation_competencies"]
        # ゴール語を一切含まない文はどの能力にも当たらない
        self.assertEqual(goals.competencies_hit("今日は良い天気ですね。", comps), [])
        # 個人差＋思いやりの文は G2/G6 に当たる
        hits = goals.competencies_hit("感じ方には個人差があり、相手を尊重することが大切。", comps)
        self.assertIn("G2", hits)
        self.assertIn("G6", hits)

    def test_learner_quiz_has_G2_and_G6(self):
        # 学習者向けゲームクイズは必ず個人差(G2)と思いやり(G6)を含む
        from src.content.beginner import build_course
        for lv in build_course()["levels"]:
            for bq in lv["quizzes"]:
                txt = " ".join([bq["question"], bq["explain"], bq["one_point"], bq["respect_note"]])
                hits = goals.competencies_hit(txt, goals.goals_def()["graduation_competencies"])
                self.assertIn("G2", hits, bq["id"])
                self.assertIn("G6", hits, bq["id"])


if __name__ == "__main__":
    unittest.main()
