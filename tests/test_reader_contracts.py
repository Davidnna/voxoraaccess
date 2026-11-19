"""Source contracts for account-scoped intelligent document reading."""

import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReaderContractsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = (ROOT / "app.py").read_text(encoding="utf-8")
        cls.backend_ast = ast.parse(cls.backend)
        cls.frontend = (ROOT / "src" / "components" / "DocumentReader.jsx").read_text(encoding="utf-8")
        cls.voice = (ROOT / "src" / "components" / "VoiceAssistant.jsx").read_text(encoding="utf-8")
        cls.reader = (ROOT / "src" / "data" / "reader.js").read_text(encoding="utf-8")

    def test_reading_progress_is_account_and_resource_scoped(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS reading_progress", self.backend)
        self.assertIn("PRIMARY KEY(user_id,resource_id)", self.backend)
        self.assertIn("REFERENCES users(id) ON DELETE CASCADE", self.backend)
        self.assertIn("REFERENCES resources(id) ON DELETE CASCADE", self.backend)

    def test_reading_progress_api_requires_login_and_resource_access(self):
        api = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "api_save_reading_progress"
        )
        source = ast.get_source_segment(self.backend, api)
        decorators = [ast.unparse(item) for item in api.decorator_list]
        self.assertIn("login_required", decorators)
        self.assertIn("accessible(r, current)", source)
        self.assertIn("reading_content_fingerprint(", source)
        self.assertIn("secrets.compare_digest", source)
        self.assertIn("db().commit()", source)

    def test_reading_progress_is_bounded_and_rejects_stale_content(self):
        self.assertIn("total_segments > 100000", self.backend)
        self.assertIn("next_index > total_segments", self.backend)
        self.assertIn("The document reading view has changed.", self.backend)
        self.assertIn("reading_fingerprint", self.backend)

    def test_reading_progress_supports_explicit_section_seeks_and_safe_checkpoints(self):
        api = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "api_save_reading_progress"
        )
        source = ast.get_source_segment(self.backend, api)
        self.assertIn("if reset:", source)
        self.assertIn("next_segment_index=EXCLUDED.next_segment_index", source)
        self.assertIn("GREATEST(reading_progress.next_segment_index, EXCLUDED.next_segment_index)", source)

    def test_read_view_returns_saved_position_and_fingerprint(self):
        site_api = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "site_data"
        )
        source = ast.get_source_segment(self.backend, site_api)
        self.assertIn('payload["resource"]["reading_fingerprint"]', source)
        self.assertIn('payload["resource"]["reading_progress"]', source)
        self.assertIn("FROM reading_progress", source)

    def test_reader_builds_sections_and_table_row_context(self):
        self.assertIn("export function buildReadingSegments", self.reader)
        self.assertIn("export function buildReadingSections", self.reader)
        self.assertIn("Column headings:", self.reader)
        self.assertIn("without marked column headings", self.reader)
        self.assertIn("table-row", self.reader)

    def test_reader_ui_exposes_resume_section_and_table_controls(self):
        for label in [
            "Continue reading",
            "Start from beginning",
            "Previous section",
            "Next section",
            "Read this section",
            "Go to section",
        ]:
            self.assertIn(label, self.frontend)
        self.assertIn("voxora:reader-command", self.frontend)
        self.assertIn("voxora:reader-progress", self.frontend)

    def test_voice_assistant_reads_segments_in_sequence_and_tracks_completion(self):
        self.assertIn("voxora:read-segments", self.voice)
        self.assertIn("voxora:reader-position", self.voice)
        self.assertIn("voxora:reader-progress", self.voice)
        self.assertIn("endIndex", self.voice)
        self.assertIn("endIndex: section.endIndex", self.frontend)
        self.assertIn("tableEndIndex", self.frontend)
        self.assertIn("suppressResume: true", self.voice)
        self.assertIn("onComplete:", self.voice)
        self.assertIn("readerRunRef", self.voice)
        self.assertIn("readerQueueRef.current && !speakingRef.current", self.voice)
        self.assertIn("resumeListening(500)", self.voice)

    def test_voice_commands_support_document_navigation(self):
        for command in [
            '"resume"',
            '"restart"',
            '"next-section"',
            '"previous-section"',
            '"current-section"',
            '"current-table"',
            '"next-table"',
            '"go-to-section"',
        ]:
            self.assertIn(command, self.voice)

    def test_reading_position_is_highlighted_in_the_document(self):
        self.assertIn('data-reader-segment-index', self.frontend)
        self.assertIn('aria-current', self.frontend)
        self.assertIn('scrollIntoView', self.frontend)


if __name__ == "__main__":
    unittest.main()
