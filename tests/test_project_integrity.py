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
        ignored_dirs = {".git", ".pytest_cache", ".mypy_cache", ".ruff_cache", "node_modules", ".venv"}
        markdown = sorted(
            path.relative_to(ROOT).as_posix()
            for path in ROOT.rglob("*")
            if path.is_file()
            and path.suffix.lower() in {".md", ".markdown"}
            and not ignored_dirs.intersection(path.relative_to(ROOT).parts)
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

    def test_assistant_resource_details_fetches_text_after_access_check(self):
        tool_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "voxora_assistant_tool"
        )
        tool_source = ast.get_source_segment(self.backend, tool_function)
        details_branch = tool_source.split('if name == "get_resource_details":', 1)[1].split(
            'if name == "save_to_library":', 1
        )[0]
        self.assertLess(
            details_branch.index("if not accessible(row, current_user)"),
            details_branch.index("timed_fetchone("),
        )
        self.assertIn(
            "SELECT extracted_text, extraction_status FROM resources WHERE id=%s",
            details_branch,
        )
        self.assertNotIn('excerpt = (row["extracted_text"]', details_branch)
        self.assertNotIn('len(row["extracted_text"]', details_branch)
        self.assertIn('"extraction_status":', details_branch)

    def test_assistant_resource_details_returns_excerpt_from_separate_reading_query(self):
        tool_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "voxora_assistant_tool"
        )
        namespace = {}
        module = ast.Module(body=[tool_function], type_ignores=[])
        exec(compile(module, "<voxora-assistant-tool-test>", "exec"), namespace)

        # This metadata row intentionally has no extracted_text column, matching
        # the production resource() query.
        metadata = {
            "id": 41,
            "owner_id": 7,
            "title": "Lecture notes",
            "description": "Accessible sample resource",
            "extension": "pdf",
            "owner_name": "Test Student",
            "visibility": "private",
        }
        reading = {"extracted_text": "x" * 9001, "extraction_status": "partial"}
        queries = []
        namespace.update({
            "resource": lambda resource_id: metadata,
            "accessible": lambda row, current_user: True,
            "timed_fetchone": lambda sql, params: queries.append((sql, params)) or reading,
        })

        result = namespace["voxora_assistant_tool"](
            "get_resource_details", {"resource_id": 41}, {"id": 7}
        )
        self.assertEqual(len(result["text_excerpt"]), 9000)
        self.assertTrue(result["excerpt_truncated"])
        self.assertEqual(result["extraction_status"], "partial")
        self.assertEqual(queries, [(
            "SELECT extracted_text, extraction_status FROM resources WHERE id=%s",
            (41,),
        )])

    def test_assistant_resource_details_does_not_fetch_text_before_access_is_granted(self):
        tool_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "voxora_assistant_tool"
        )
        namespace = {}
        module = ast.Module(body=[tool_function], type_ignores=[])
        exec(compile(module, "<voxora-assistant-tool-access-test>", "exec"), namespace)
        namespace.update({
            "resource": lambda resource_id: {"id": resource_id},
            "accessible": lambda row, current_user: False,
            "timed_fetchone": lambda *args: self.fail("Reading text must not be fetched before access is checked."),
        })
        result = namespace["voxora_assistant_tool"](
            "get_resource_details", {"resource_id": 41}, {"id": 9}
        )
        self.assertIn("error", result)

    def test_document_reading_requests_enable_resource_tools(self):
        assistant_chat = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "assistant_chat"
        )
        source = ast.get_source_segment(self.backend, assistant_chat)
        self.assertIn("resource_read_intent = bool(re.search(", source)
        self.assertIn(r"read|summari[sz]e|explain|describe", source)
        self.assertIn("or resource_read_intent", source)
        self.assertIn("if resource_intent:", source)
        self.assertIn("get_resource_details with the numeric resource ID in", source)

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

    def test_upload_extracts_document_content_and_persists_structure(self):
        upload_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "upload"
        )
        source = ast.get_source_segment(self.backend, upload_function)
        self.assertIn("extraction = extract_document(", source)
        self.assertIn('extraction["text"]', source)
        self.assertIn('Jsonb(extraction["blocks"])', source)
        self.assertIn('extraction["status"]', source)
        self.assertIn('extraction["truncated"]', source)
        self.assertNotIn('                    "",\n                    file_data,', source)
        self.assertLess(source.index('if dup:'), source.index('extraction = extract_document('))

    def test_existing_uploads_can_be_reprocessed_by_their_owner(self):
        extract_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "api_extract_resource"
        )
        source = ast.get_source_segment(self.backend, extract_function)
        self.assertIn('if r["owner_id"] != current["id"]', source)
        self.assertIn('extract_document(', source)
        self.assertIn('SELECT file_data, preview_data FROM resources', source)
        self.assertIn('if preview_data is None:', source)
        self.assertIn('UPDATE resources SET extracted_text=%s, extracted_blocks=%s', source)
        self.assertIn('extraction_truncated=%s', source)
        self.assertIn('db().commit()', source)
        self.assertIn('response.headers["Cache-Control"] = "private, no-store"', source)
        self.assertIn('"needs_ocr"', source)

    def test_document_extraction_schema_migrations_are_present(self):
        for field in [
            "extracted_blocks JSONB",
            "extraction_status TEXT",
            "extraction_method TEXT",
            "extraction_warnings TEXT",
            "extraction_truncated BOOLEAN",
            "page_count INTEGER",
        ]:
            self.assertIn(field, self.backend)
        self.assertIn('ALTER TABLE resources ADD COLUMN IF NOT EXISTS extracted_blocks', self.backend)
        self.assertIn('ALTER TABLE resources ADD COLUMN IF NOT EXISTS extraction_truncated', self.backend)

    def test_full_document_content_is_returned_only_for_reading_route(self):
        site_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "site_data"
        )
        source = ast.get_source_segment(self.backend, site_function)
        self.assertIn('reading_view = path.endswith("/read")', source)
        self.assertIn('payload["resource"]["reading_blocks"]', source)
        self.assertIn('payload["resource"]["reading_text"]', source)
        self.assertIn('"preview_available"', source)
        self.assertIn('CASE WHEN %s THEN r.extracted_text ELSE LEFT(r.extracted_text, 16001) END', source)
        self.assertIn("CASE WHEN %s THEN r.extracted_blocks ELSE '[]'::jsonb END", source)

    def test_ods_conversion_has_libreoffice_calc_installed(self):
        self.assertIn("libreoffice-calc", (ROOT / "Dockerfile").read_text(encoding="utf-8"))
        self.assertIn("libreoffice-calc", (ROOT / "apt.txt").read_text(encoding="utf-8"))
        self.assertIn("libreoffice-calc", (ROOT / "README.md").read_text(encoding="utf-8"))

    def test_all_open_document_formats_use_the_converted_pdf_preview(self):
        self.assertIn('CONVERTED_PREVIEW_EXTENSIONS = {"docx", "pptx", "rtf", "odt", "ods", "odp"}', self.backend)
        preview_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "preview"
        )
        source = ast.get_source_segment(self.backend, preview_function)
        for extension in ["rtf", "odt", "ods", "odp"]:
            self.assertIn(f"'{extension}'", source)

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

    def test_preview_hash_is_persisted_for_safe_etag_validation(self):
        self.assertIn("preview_sha256 TEXT", self.backend)
        self.assertIn("preview_size_bytes BIGINT", self.backend)
        self.assertIn("ALTER TABLE resources ADD COLUMN IF NOT EXISTS preview_sha256 TEXT", self.backend)
        self.assertIn("ALTER TABLE resources ADD COLUMN IF NOT EXISTS preview_size_bytes BIGINT", self.backend)
        self.assertIn("hashlib.sha256(preview_data).hexdigest()", self.backend)
        self.assertIn("preview_data,preview_sha256,preview_size_bytes,created_at", self.backend)

    def test_preview_supports_private_cache_revalidation(self):
        preview_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "preview"
        )
        source = ast.get_source_segment(self.backend, preview_function)
        self.assertIn('request.headers.get("If-None-Match")', source)
        self.assertIn("request.if_none_match.contains_weak(preview_digest)", source)
        self.assertIn('response.set_etag(preview_digest)', source)
        self.assertIn('"private, no-cache, must-revalidate"', source)
        self.assertIn('response.headers["Vary"] = "Cookie"', source)
        self.assertNotIn('"private, no-store"', source)

    def test_preview_head_and_not_modified_requests_avoid_binary_fetch(self):
        preview_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "preview"
        )
        source = ast.get_source_segment(self.backend, preview_function)
        self.assertIn('request.method == "HEAD"', source)
        self.assertIn('response.content_length = preview_size', source)
        self.assertIn('response = Response(status=304)', source)
        self.assertIn('r.preview_size_bytes ELSE r.size_bytes END AS preview_size', source)
        self.assertNotIn('octet_length(', source)

    def test_server_timing_separates_database_query_time(self):
        self.assertIn("def timed_fetchone(", self.backend)
        self.assertIn("def timed_fetchall(", self.backend)
        self.assertIn("db;dur=", self.backend)
        self.assertIn("db_ms=%.1f", self.backend)

    def test_site_api_database_queries_are_timed(self):
        site_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "site_data"
        )
        source = ast.get_source_segment(self.backend, site_function)
        self.assertIn("timed_fetchone(", source)
        self.assertIn("timed_fetchall(", source)

    def test_react_shell_uses_the_compiled_application_stylesheet(self):
        shell = (ROOT / "templates" / "spa.html").read_text(encoding="utf-8")
        app_css = (ROOT / "src" / "styles" / "app.css").read_text(encoding="utf-8")
        self.assertIn("dist/app.css", shell)
        self.assertIn("font: 16px/1.65 Inter", app_css)
        self.assertIn("color: var(--react-teal)", app_css)

    def test_legacy_preview_hash_backfill_uses_the_same_access_scope(self):
        preview_function = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "preview"
        )
        source = ast.get_source_segment(self.backend, preview_function)
        self.assertIn('"SELECT r.preview_data " + access_sql', source)
        self.assertNotIn("WHERE id = %s AND owner_id = %s OR", source)

    def test_four_space_editor_configuration(self):
        config = (ROOT / ".editorconfig").read_text(encoding="utf-8")
        self.assertIn("indent_style = space", config)
        self.assertIn("indent_size = 4", config)

    def test_database_connections_have_a_bounded_connect_timeout(self):
        self.assertIn('connect_timeout=int(os.environ.get("VOXORA_DB_CONNECT_TIMEOUT", "8"))', self.backend)
        self.assertIn('"connect_timeout": int(os.environ.get("VOXORA_DB_CONNECT_TIMEOUT", "8"))', self.backend)

    def test_database_startup_stages_are_logged(self):
        self.assertIn('VOXORA_STARTUP stage=schema_init status=starting', self.backend)
        self.assertIn('VOXORA_STARTUP stage=schema_init status=ready', self.backend)
        self.assertIn('VOXORA_STARTUP stage=db_pool status=starting', self.backend)
        self.assertIn('VOXORA_STARTUP stage=db_pool status=ready', self.backend)

    def test_health_endpoint_is_lightweight_and_configured(self):
        self.assertIn('@app.get("/healthz")', self.backend)
        self.assertIn('healthCheckPath: /healthz', (ROOT / "render.yaml").read_text(encoding="utf-8"))

    def test_render_worker_count_matches_single_cpu_default(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        render = (ROOT / "render.yaml").read_text(encoding="utf-8")
        self.assertIn('--workers ${WEB_CONCURRENCY:-1}', dockerfile)
        self.assertIn('--workers 1', render)
        self.assertIn('exec gunicorn', dockerfile)

    def test_database_ssl_mode_supports_local_and_production_postgres(self):
        self.assertIn(
            'DB_SSLMODE = os.environ.get("VOXORA_DB_SSLMODE", "require")',
            self.backend,
        )
        self.assertIn("sslmode=DB_SSLMODE", self.backend)
        self.assertIn('"sslmode": DB_SSLMODE', self.backend)
        self.assertIn("VOXORA_DB_SSLMODE=disable", (ROOT / "README.md").read_text(encoding="utf-8"))

    def test_frontend_styles_are_grouped_under_styles_directory(self):
        main = (ROOT / "src" / "main.jsx").read_text(encoding="utf-8")
        self.assertIn('import "./styles/app.css";', main)
        self.assertTrue((ROOT / "src" / "styles" / "app.css").is_file())
        self.assertFalse((ROOT / "src" / "dashboard.css").exists())

    def test_only_the_active_react_shell_template_is_retained(self):
        templates = ROOT / "templates"
        self.assertEqual(
            sorted(path.name for path in templates.glob("*.html")),
            ["spa.html"],
        )
        self.assertFalse((ROOT / "static" / "js" / "voxora.js").exists())
        self.assertFalse((ROOT / "static" / "css" / "style.css").exists())
        shell = (templates / "spa.html").read_text(encoding="utf-8")
        self.assertIn('id="voxora-app-root"', shell)

    def test_only_current_deployment_configuration_is_retained(self):
        self.assertFalse((ROOT / "vercel.json").exists())
        self.assertTrue((ROOT / "render.yaml").is_file())
        self.assertTrue((ROOT / "Dockerfile").is_file())
        self.assertTrue((ROOT / ".dockerignore").is_file())

    def test_generated_frontend_assets_are_not_committed(self):
        ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("static/dist/", ignore)
        self.assertIn("node_modules/", ignore)

    def test_flask_routes_render_through_the_single_react_shell(self):
        wrapper = next(
            node for node in self.backend_ast.body
            if isinstance(node, ast.FunctionDef) and node.name == "render_template"
        )
        source = ast.get_source_segment(self.backend, wrapper)
        self.assertIn('_flask_render_template(\n        "spa.html"', source)
        self.assertIn("initial_path=request.path", source)
        self.assertIn("csrf_value=csrf()", source)


if __name__ == "__main__":
    unittest.main()
