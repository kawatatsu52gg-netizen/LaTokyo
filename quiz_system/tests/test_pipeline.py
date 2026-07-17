"""
最小テスト（stdlib unittest）。外部依存なしで実行:
    cd quiz_system && python3 -m unittest -v tests.test_pipeline
"""
import unittest

from src.schemas import Quiz, Claim
from src.validation.qa import qa_quiz, detect_duplicates
from src.normalization.normalize import extract_candidates
from src.claims.extract import build_claims, classify


def _good_quiz(**over) -> Quiz:
    base = dict(
        quiz_id="Q-TEST", chapter=1, level=1,
        question="外陰部が指す範囲は？",
        choices={"A": "外性器全体の総称", "B": "内部の管の名称",
                 "C": "子宮と卵巣の総称", "D": "尿道口だけの名称"},
        correct_answer="A",
        explanation="外陰部は外性器全体の総称であり膣とは区別される。",
        choice_explanations={"A": "正しい。総称。", "B": "膣のこと。",
                             "C": "内性器。", "D": "一部のみ。"},
        practical_point="用語を分けて説明できる。",
        individual_variation_note="形には個人差がある。",
        consent_note="",
        source_ids=["SRC-0001"], claim_ids=["CLM-1001"],
        evidence_level="A", needs_verification="", review_status="reviewed",
    )
    base.update(over)
    return Quiz.from_dict(base)


class TestQA(unittest.TestCase):
    def test_good_quiz_publishable(self):
        r = qa_quiz(_good_quiz())
        self.assertTrue(r.publishable, r.errors)

    def test_missing_source_rejected(self):
        r = qa_quiz(_good_quiz(claim_ids=[]))
        self.assertFalse(r.publishable)

    def test_evidence_D_rejected(self):
        r = qa_quiz(_good_quiz(evidence_level="D"))
        self.assertFalse(r.publishable)

    def test_absolute_term_in_authoritative_rejected(self):
        r = qa_quiz(_good_quiz(explanation="女性は必ず感じる。"))
        self.assertFalse(r.publishable)

    def test_absolute_term_in_distractor_allowed(self):
        # 誤り選択肢に断定語があっても、解説で否定していれば公開可（警告のみ）
        r = qa_quiz(_good_quiz(
            choices={"A": "外性器全体の総称", "B": "全員が同じと決まっている",
                     "C": "内性器", "D": "尿道口だけ"},
            choice_explanations={"A": "正しい。総称。", "B": "個人差があり誤り。",
                                 "C": "内性器。", "D": "一部のみ。"}))
        self.assertTrue(r.publishable, r.errors)

    def test_all_of_above_rejected(self):
        r = qa_quiz(_good_quiz(choices={"A": "外性器の総称", "B": "膣のこと",
                                        "C": "内性器", "D": "上記すべて"}))
        self.assertFalse(r.publishable)

    def test_choice_length_bias_warns(self):
        long = "外性器全体をまとめて指す非常に長い説明文をここに入れて偏りを作る" * 2
        r = qa_quiz(_good_quiz(choices={"A": long, "B": "膣", "C": "子宮", "D": "尿道"}))
        self.assertTrue(any("文章量" in w for w in r.warnings))

    def test_duplicate_detection(self):
        q1 = _good_quiz(quiz_id="Q-A")
        q2 = _good_quiz(quiz_id="Q-B")
        dups = detect_duplicates([q1, q2])
        self.assertTrue(dups)


class TestExtraction(unittest.TestCase):
    def test_candidates_and_claims(self):
        body = "陰部神経は仙骨神経叢(S2-S4)に由来する。 [07:15]\n短い"
        cands = extract_candidates(body)
        self.assertTrue(cands)
        claims = build_claims(cands)
        self.assertTrue(all(c.verification_status == "needs_review" for c in claims))
        self.assertTrue(all(c.evidence_level == "D" for c in claims))

    def test_classify_nerve(self):
        tags = classify("陰核背神経は陰部神経の枝である")
        self.assertEqual(tags["nerve"], "陰核背神経")


class TestSchemas(unittest.TestCase):
    def test_verified_claim_requires_quote(self):
        c = Claim(claim_id="CLM-X", statement="test", verification_status="verified",
                  evidence_level="A", source_quote="")
        self.assertTrue(any("source_quote" in e for e in c.validate()))


if __name__ == "__main__":
    unittest.main()
