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


    def test_database_connections_use_a_bounded_worker_pool(self):
        self.assertIn("from psycopg_pool import ConnectionPool", self.backend)
        self.assertIn("DB_POOL = ConnectionPool(", self.backend)
        self.assertIn("min_size=1", self.backend)
        self.assertIn("max_size=4", self.backend)
        self.assertIn("DB_POOL.wait(timeout=10)", self.backend)
        self.assertIn("DB_POOL.getconn()", self.backend)
        self.assertIn("DB_POOL.putconn(c)", self.backend)

    def test_server_timing_is_logged_without_student_ui_metrics(self):
        self.assertIn("@app.after_request", self.backend)
        self.assertIn('response.headers["Server-Timing"]', self.backend)
        self.assertIn("VOXORA_REQUEST_TIMING", self.backend)
        self.assertIn("db_pool_wait_ms", self.backend)

    def test_user_lookup_is_cached_per_request(self):
        user_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "user"
        )
        source = ast.get_source_segment(self.backend, user_function)
        self.assertIn("_voxora_user_loaded", source)
        self.assertIn("_voxora_user", source)

    def test_preview_fetches_binary_and_checks_access_in_one_query(self):
        preview_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "preview"
        )
        source = ast.get_source_segment(self.backend, preview_function)
        self.assertIn("preview_payload", source)
        self.assertIn("r.owner_id = %s", source)
        self.assertIn("r.visibility = 'public'", source)
        self.assertIn("FROM shares s", source)
        self.assertNotIn("resource(rid)", source)
        self.assertNotIn("accessible(", source)

    def test_resource_page_combines_access_and_library_membership(self):
        site_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "site_data"
        )
        source = ast.get_source_segment(self.backend, site_function)
        self.assertIn("AS in_library", source)
        self.assertIn("FROM library l", source)
        self.assertIn("FROM shares s", source)

    def test_dashboard_counts_are_returned_by_one_query(self):
        self.assertIn("SELECT COUNT(*) FROM resources WHERE owner_id = %s", self.backend)
        self.assertIn("SELECT COUNT(*) FROM library WHERE user_id = %s", self.backend)
        self.assertIn("SELECT COUNT(*) FROM shares WHERE user_id = %s", self.backend)

    def test_resource_list_indexes_are_created(self):
        self.assertIn("idx_resources_owner_created", self.backend)
        self.assertIn("idx_library_user_created", self.backend)
        self.assertIn("idx_shares_user_created", self.backend)

    def test_four_space_editor_configuration(self):
        config = (ROOT / ".editorconfig").read_text(encoding="utf-8")
        self.assertIn("indent_style = space", config)
        self.assertIn("indent_size = 4", config)


if __name__ == "__main__":
    unittest.main()
