"""Content Generator のテスト（KB=SSoT、14形式、テンプレ解決、KB更新反映）。"""
import unittest
import tempfile
from pathlib import Path

from src.kb.build import build
from src.kb.store import KB
from src.kb.bundle import build_bundle
from src.content.generator import load_templates, resolve_format
from src.content.renderers import ARCHETYPES

ROOT = Path(__file__).resolve().parent.parent


class TestTemplates(unittest.TestCase):
    def test_14_formats_loaded(self):
        specs = load_templates()
        self.assertGreaterEqual(len(specs), 14)

    def test_alias_resolution(self):
        specs = load_templates()
        self.assertEqual(resolve_format("instagram", specs)["format"], "instagram_carousel")
        self.assertEqual(resolve_format("slide", specs)["format"], "halii_slide")
        self.assertEqual(resolve_format("youtube", specs)["format"], "youtube_script")
        self.assertEqual(resolve_format("患者", specs)["format"], "patient")

    def test_every_archetype_exists(self):
        specs = load_templates()
        for s in specs.values():
            self.assertIn(s["archetype"], set(ARCHETYPES) | {"quiz"})


class TestBundleAndRender(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dbpath = Path(cls.tmp) / "kb.db"
        build(cls.dbpath, log=lambda *a: None)

    def test_bundle_from_entity_has_sourced_facts(self):
        kb = KB(self.dbpath)
        b = build_bundle(kb, "陰部神経", min_evidence="A")
        kb.close()
        self.assertTrue(b.facts)
        # 全factが出典(source_ids)を持つ = SSoT追跡性
        self.assertTrue(all(f.source_ids for f in b.facts if f.kind == "claim"))

    def test_all_archetypes_render_nonempty_with_sources(self):
        kb = KB(self.dbpath)
        b = build_bundle(kb, "陰核", min_evidence="B")
        kb.close()
        for name, fn in ARCHETYPES.items():
            spec = {"format": name, "archetype": name, "label": name, "config": {}}
            md = fn(b, spec)
            self.assertIn("Knowledge Base", md, f"{name} にSSoT表記が無い")
            self.assertTrue(len(md) > 50)

    def test_unknown_subject_raises(self):
        kb = KB(self.dbpath)
        with self.assertRaises(ValueError):
            build_bundle(kb, "存在しない主題XYZ")
        kb.close()

    def test_kb_update_reflected(self):
        # KBに新しい検証済みclaimを足すと、生成の素になるfactが増える（＝最新反映）
        kb = KB(self.dbpath)
        before = len(build_bundle(kb, "陰核", min_evidence="B").facts)
        kb.upsert_claim({
            "claim_id": "CLM-TEST", "statement": "陰核は感覚に富む器官である(テスト)。",
            "topic_id": "TOP-external", "evidence_level": "A", "verification_status": "verified",
            "sources": [{"source_id": "TXT-0001", "locator": "test", "source_evidence": "A"}],
            "entities": ["ENT-clitoris"],
        })
        kb.commit()
        after = len(build_bundle(kb, "陰核", min_evidence="B").facts)
        kb.close()
        self.assertGreater(after, before)


if __name__ == "__main__":
    unittest.main()
