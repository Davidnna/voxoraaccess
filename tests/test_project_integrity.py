"""Dependency-free regression checks for Voxora's critical source contracts."""

import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ProjectIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = (ROOT / "app.py").read_text(encoding="utf-8")
        cls.backend_ast = ast.parse(cls.backend)
        cls.frontend = (ROOT / "src" / "App.jsx").read_text(encoding="utf-8")
        cls.entry = (ROOT / "src" / "main.jsx").read_text(encoding="utf-8")
        cls.voice = (
            ROOT / "src" / "components" / "VoiceAssistant.jsx"
        ).read_text(encoding="utf-8")

    def test_readme_is_the_only_markdown_file(self):
        markdown = sorted(
            path.relative_to(ROOT).as_posix()
            for path in ROOT.rglob("*")
            if path.is_file() and path.suffix.lower() in {".md", ".markdown"}
        )
        self.assertEqual(markdown, ["README.md"])

    def test_python_backend_parses(self):
        ast.parse(self.backend)

    def test_react_router_wraps_the_application(self):
        self.assertIn("<BrowserRouter>", self.entry)
        self.assertIn("<AppRoutes/>", self.entry)
        self.assertIn("<Routes>", self.frontend)
        self.assertIn("<Route path=\"*\"", self.frontend)

    def test_page_requests_are_cancellable(self):
        self.assertIn("new AbortController()", self.frontend)
        self.assertIn("signal: controller.signal", self.frontend)
        self.assertIn("controller.abort()", self.frontend)

    def test_failed_page_load_can_be_retried(self):
        self.assertIn("setRefreshKey((current) => current + 1)", self.frontend)
        self.assertIn("Try again", self.frontend)

    def test_signout_failure_is_visible_to_the_user(self):
        self.assertIn(
            'setLocalFlash([{ category: "error", message: err.message }])',
            self.frontend,
        )

    def test_form_errors_use_accessible_alert_semantics(self):
        self.assertIn('role={m.category==="error"?"alert":"status"}', self.frontend)
        self.assertIn('aria-live={m.category==="error"?"assertive":"polite"}', self.frontend)

    def test_upload_size_limit_is_configurable(self):
        self.assertIn('MAX_MB = int(os.environ.get("VOXORA_MAX_UPLOAD_MB", "20"))', self.backend)
        self.assertIn('message = f"Files must be {MAX_MB} MB or smaller."', self.backend)
        self.assertIn('request.headers.get("X-Requested-With") == "XMLHttpRequest"', self.backend)
        self.assertIn('"X-Requested-With":"XMLHttpRequest"', self.frontend)

    def test_resource_access_requires_authentication(self):
        access_function = next(
            node
            for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "accessible"
        )
        access_source = ast.get_source_segment(self.backend, access_function)
        self.assertIn("if not u:", access_source)
        self.assertIn('r["owner_id"] == u["id"]', access_source)
        self.assertIn('r["visibility"] == "public"', access_source)
        self.assertIn('FROM shares WHERE resource_id=%s AND user_id=%s', access_source)

    def test_post_requests_have_a_csrf_guard(self):
        csrf_function = next(
            node
            for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "check_csrf"
        )
        decorators = [ast.unparse(item) for item in csrf_function.decorator_list]
        self.assertIn("app.before_request", decorators)
        self.assertIn('request.method == "POST"', ast.get_source_segment(self.backend, csrf_function))
        self.assertIn("secrets.compare_digest", ast.get_source_segment(self.backend, csrf_function))

    def test_voice_assistant_remains_mounted_at_application_root(self):
        self.assertIn("<VoiceAssistant/>", self.entry)
        self.assertIn("/api/assistant/chat", self.voice)

    def test_four_space_editor_configuration(self):
        config = (ROOT / ".editorconfig").read_text(encoding="utf-8")
        self.assertIn("indent_style = space", config)
        self.assertIn("indent_size = 4", config)


if __name__ == "__main__":
    unittest.main()
