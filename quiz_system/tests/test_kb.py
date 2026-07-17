"""KB層のテスト（stdlib unittest）。一時DBを使い、シードから構築して検証。"""
import unittest
from pathlib import Path
import tempfile

from src.kb.store import KB, evidence_min, evidence_at_least
from src.kb.build import build
from src.kb.generate_kb import generate
from src.kb.graph import find_paths, path_evidence
from src.schemas import Quiz
from src.validation.qa import qa_quiz

ROOT = Path(__file__).resolve().parent.parent


class TestEvidence(unittest.TestCase):
    def test_min_and_threshold(self):
        self.assertEqual(evidence_min(["A", "B", "C"]), "C")
        self.assertEqual(evidence_min(["A", "A"]), "A")
        self.assertTrue(evidence_at_least("A", "B"))
        self.assertFalse(evidence_at_least("C", "A"))


class TestKBBuildGenerate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dbpath = Path(cls.tmp) / "kb_test.db"
        cls.stats = build(cls.dbpath, log=lambda *a: None)
        cls.kb = KB(cls.dbpath)

    @classmethod
    def tearDownClass(cls):
        cls.kb.close()

    def test_sources_multiple_types(self):
        by = self.kb.counts_by("sources", "source_type")
        self.assertIn("paper", by)
        self.assertIn("textbook", by)
        self.assertIn("youtube", by)

    def test_alias_resolution(self):
        self.assertEqual(self.kb.resolve_entity("クリトリス"), "ENT-clitoris")
        self.assertEqual(self.kb.resolve_entity("pudendal nerve"), "ENT-pudendal")

    def test_multisource_claim(self):
        # CLM-3001 は教科書+論文+動画の3ソース(Evidence統合)
        self.assertGreaterEqual(self.kb.claim_source_count("CLM-3001"), 3)

    def test_graph_path(self):
        paths = find_paths(self.kb, "ENT-clitoris-glans", max_hops=3, min_evidence="A")
        self.assertTrue(any(len(p) >= 2 for p in paths))
        for p in paths:
            self.assertEqual(path_evidence(p), evidence_min([e["evidence_level"] for e in p]))

    def test_generate_evidence_A_only(self):
        qs = generate(self.kb, min_evidence="A")
        self.assertTrue(qs)
        types = {q["quiz_type"] for q in qs}
        self.assertEqual(types, {"fill_blank", "multiple_choice", "application", "case"})
        for q in qs:
            self.assertEqual(q["evidence_level"], "A")   # A限定
            self.assertTrue(q["claim_ids"])              # 出典必須
            self.assertTrue(q["source_ids"])
            self.assertTrue(qa_quiz(Quiz.from_dict(q)).publishable)  # QA公開可


if __name__ == "__main__":
    unittest.main()
