"""Source-level accessibility regression checks for Voxora's React interface.

These checks protect important semantics and styling contracts. They do not
replace browser-based WCAG evaluation or testing with assistive technology.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _relative_luminance(hex_color):
    value = hex_color.lstrip("#")
    channels = [int(value[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    linear = [
        channel / 12.92 if channel <= 0.04045
        else ((channel + 0.055) / 1.055) ** 2.4
        for channel in channels
    ]
    return (
        0.2126 * linear[0]
        + 0.7152 * linear[1]
        + 0.0722 * linear[2]
    )


def _contrast_ratio(first, second):
    lighter, darker = sorted(
        (_relative_luminance(first), _relative_luminance(second)),
        reverse=True,
    )
    return (lighter + 0.05) / (darker + 0.05)


class AccessibilityContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = (ROOT / "src" / "App.jsx").read_text(encoding="utf-8")
        cls.reader_component = (ROOT / "src" / "components" / "DocumentReader.jsx").read_text(encoding="utf-8")
        cls.reader_data = (ROOT / "src" / "data" / "reader.js").read_text(encoding="utf-8")
        cls.voice = (
            ROOT / "src" / "components" / "VoiceAssistant.jsx"
        ).read_text(encoding="utf-8")
        cls.css = (ROOT / "src" / "styles" / "app.css").read_text(encoding="utf-8")
        cls.shell = (ROOT / "templates" / "spa.html").read_text(encoding="utf-8")

    def test_document_language_is_declared(self):
        self.assertRegex(self.shell, r'<html\s+lang="en">')

    def test_skip_link_targets_focusable_main_landmark(self):
        self.assertIn('className="react-skip-link" href="#main-content"', self.app)
        self.assertIn('<main id="main-content" tabIndex="-1"', self.app)

    def test_main_landmark_exposes_loading_state(self):
        self.assertIn(
            'aria-busy={pageLoading && (!data || data.path !== path)}',
            self.app,
        )

    def test_public_navigation_announces_current_page(self):
        self.assertIn('aria-current={path===href?"page":undefined}', self.app)

    def test_signed_in_user_name_is_not_overridden_by_generic_label(self):
        self.assertNotIn('aria-label="Signed in as"', self.app)
        self.assertIn('className="react-user">{user.name}</span>', self.app)

    def test_accessible_reader_renders_semantic_document_blocks(self):
        self.assertIn('function DocumentBlocks({ blocks, segmentTargets })', self.reader_component)
        self.assertIn('<th scope="col"', self.reader_component)
        self.assertIn('<caption>{block.caption || "Document table"}</caption>', self.reader_component)
        self.assertIn('role="region"', self.reader_component)
        self.assertIn('buildListTree', self.reader_component)
        self.assertIn('renderListTree', self.reader_component)
        self.assertIn('colSpan: metadata?.colspan > 1 ? metadata.colspan : undefined', self.reader_component)
        self.assertIn('rowSpan: metadata?.rowspan > 1 ? metadata.rowspan : undefined', self.reader_component)
        self.assertIn('block.type === "speaker_notes"', self.reader_component)
        self.assertIn('block.type === "image_placeholder"', self.reader_component)
        self.assertIn('path.endsWith("/read")&&data.resource', self.app)
        self.assertIn("Refresh reading view", self.reader_component)
        self.assertIn("<thead>", self.reader_component)

    def test_document_extractor_preserves_explicit_heading_list_and_table_metadata(self):
        extractor = (ROOT / "document_accessibility.py").read_text(encoding="utf-8")
        self.assertIn("def _docx_heading_level", extractor)
        self.assertIn("def _docx_list_info", extractor)
        self.assertIn("def _docx_table_grid", extractor)
        self.assertIn("def _pptx_table_grid", extractor)
        self.assertIn('extraction_mode="layout"', extractor)
        self.assertIn('"cell_spans"', extractor)
        self.assertIn('"speaker_notes"', extractor)
        self.assertIn('"image_placeholder"', extractor)

    def test_student_interface_does_not_expose_internal_extraction_methods(self):
        backend = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertNotIn('"extraction_method": r["extraction_method"]', backend)
        self.assertNotIn('"method": extraction["method"]', backend)
        self.assertNotIn("Extraction method:", self.app)
        self.assertIn("Preparing your reading view.", self.app)

    def test_reader_controls_are_labelled_and_use_voxora_speech(self):
        self.assertIn('label htmlFor="reader-text-size">Text size</label>', self.reader_component)
        self.assertIn('aria-valuetext={`${readerTextSize} percent`}', self.reader_component)
        self.assertIn('new Event("voxora:stop-reading")', self.reader_component)
        self.assertIn('window.addEventListener("voxora:read-segments", readSegments)', self.voice)
        self.assertIn('window.addEventListener("voxora:stop-reading", stopDocument)', self.voice)
        self.assertIn('This browser does not support Voxora voice playback', self.voice)
        self.assertIn('Microphone mute affects input only. It must never disable speaker output.', self.voice)
        self.assertNotIn('Speech output is muted', self.voice)

    def test_reader_uses_structured_segments_without_duplicate_page_text(self):
        self.assertIn('cached.resource?.reading_text || cached.resource?.text_excerpt', self.app)
        self.assertIn('result.resource?.reading_text || result.resource?.text_excerpt', self.app)
        self.assertIn('buildReadingSegments(blocks)', self.reader_component)
        self.assertIn('resource.reading_text', self.reader_component)
        self.assertIn('voxora:read-segments', self.voice)
        self.assertIn('voxora:reader-progress', self.voice)
        self.assertIn('suppressResume: true', self.voice)

    def test_document_preview_has_named_frame_and_new_tab_alternative(self):
        self.assertIn('className="react-document-frame"', self.app)
        self.assertIn('title={(isPdf?', self.app)
        self.assertIn('aria-describedby="document-preview-help"', self.app)
        self.assertIn('target="_blank" rel="noopener noreferrer"', self.app)
        self.assertIn('Open preview in a new tab', self.app)
        self.assertIn('Scanned text, diagrams, equations, charts and complex layouts may not be represented accurately.', self.reader_component)

    def test_form_focus_indicator_is_solid_and_visible(self):
        self.assertIn('outline: 3px solid var(--react-teal);', self.css)
        self.assertNotIn('outline: 3px solid #007a7825;', self.css)

    def test_assistant_focus_indicators_use_high_contrast_colour(self):
        self.assertIn(
            '.voxora-assistant-root button:focus-visible,.voxora-assistant-compose input:focus-visible{outline:3px solid #075e58;',
            self.css,
        )
        self.assertIn(
            '.voxora-assistant-notice button:focus-visible{outline:3px solid #075e58;',
            self.css,
        )
        self.assertIn(
            '.voxora-control-dock button:focus-visible{outline:3px solid #075e58;',
            self.css,
        )

    def test_focus_colours_exceed_three_to_one_non_text_contrast(self):
        self.assertGreaterEqual(_contrast_ratio("#007a78", "#fffdf5"), 3.0)
        self.assertGreaterEqual(_contrast_ratio("#075e58", "#ffffff"), 3.0)

    def test_primary_text_combinations_meet_wcag_aa_contrast(self):
        combinations = [
            ("#14211b", "#fffdf5"),
            ("#66736b", "#fffdf5"),
            ("#007a78", "#fffdf5"),
            ("#684b12", "#fff6df"),
            ("#f4f7ef", "#12372a"),
            ("#14211b", "#c7f000"),
        ]
        for foreground, background in combinations:
            with self.subTest(foreground=foreground, background=background):
                self.assertGreaterEqual(_contrast_ratio(foreground, background), 4.5)

    def test_voice_controls_are_portaled_and_fixed_to_the_viewport_bottom(self):
        self.assertIn('import { createPortal } from "react-dom";', self.voice)
        self.assertIn('return createPortal(<>', self.voice)
        self.assertIn('</>, document.body);', self.voice)
        self.assertNotIn("footerVisible", self.voice)
        self.assertNotIn("is-footer-visible", self.voice)
        dock_rule = re.search(r"\.voxora-control-dock\{([^}]+)\}", self.css)
        self.assertIsNotNone(dock_rule)
        self.assertIn("position:fixed !important", dock_rule.group(1))
        self.assertIn("bottom:", dock_rule.group(1))
        self.assertIn("left:50% !important", dock_rule.group(1))
        self.assertNotIn(".voxora-control-dock.is-footer-visible", self.css)

    def test_voice_controls_have_accessible_names_and_toggle_state(self):
        self.assertIn('role="region" aria-label="Voxora controls"', self.voice)
        self.assertIn('aria-pressed={Boolean(active && !muted)}', self.voice)
        self.assertIn('{muted ? "Unmute microphone" : active ? "Mute microphone" : "Enable microphone"}', self.voice)
        self.assertIn('> Stop speaking</button>', self.voice)
        self.assertIn('> {active ? "Pause access" : "Resume access"}</button>', self.voice)
        self.assertIn('<span aria-hidden="true">🎙</span>', self.voice)

    def test_voice_status_does_not_announce_each_cooldown_second(self):
        self.assertIn('role="status" aria-live="polite" aria-atomic="true"', self.voice)
        self.assertIn('{retrySeconds > 0 ? "Please wait"', self.voice)
        self.assertIn('{retrySeconds > 0 && <span aria-hidden="true">· {retrySeconds}s</span>}', self.voice)

    def test_reduced_motion_preferences_are_respected(self):
        self.assertIn('@media (prefers-reduced-motion: reduce)', self.css)
        self.assertIn('animation-duration: .01ms !important;', self.css)
        self.assertIn('scroll-behavior: auto !important;', self.css)

    def test_voice_notification_live_region_is_mounted_before_messages(self):
        self.assertIn('role="status" aria-live="polite" aria-atomic="true"', self.voice)
        self.assertIn('!notice ? " is-empty"', self.voice)
        self.assertNotIn('{notice && <div className={"voxora-assistant-notice"', self.voice)
        self.assertIn('.voxora-assistant-notice.is-empty', self.css)

    def test_microphone_permission_errors_stop_recognition_and_reset_access(self):
        error_handler = self.voice.split('recognition.onerror = (event) => {', 1)[1].split('recognition.onend =', 1)[0]
        self.assertIn('event.error === "not-allowed"', error_handler)
        self.assertIn('event.error === "service-not-allowed"', error_handler)
        self.assertIn('recognition.stop()', error_handler)
        self.assertIn('setActive(false)', error_handler)
        self.assertIn('event.error === "audio-capture"', error_handler)

    def test_speech_recognition_uses_echo_aware_barge_in_during_playback(self):
        self.assertIn('navigator.mediaDevices.getUserMedia({', self.voice)
        self.assertIn('echoCancellation: true, noiseSuppression: true, autoGainControl: true', self.voice)
        self.assertIn('const recentUserVoice = echoMonitorReadyRef.current && Date.now() <= userVoiceUntilRef.current', self.voice)
        self.assertIn('if (!recentUserVoice || isLikelySpeechEcho(transcript)) continue;', self.voice)
        self.assertIn('interruptSpeechRef.current?.({ userBargeIn: true });', self.voice)
        self.assertIn('recognition.onend = () => {', self.voice)
        self.assertIn('if (recognitionRef.current !== recognition) return;', self.voice)
        self.assertIn('audioOutputGuardUntilRef.current = Date.now() + (echoAwareBargeIn ? 350 : 900)', self.voice)
        self.assertIn('ignoreRecognitionResultsRef.current = !echoAwareBargeIn', self.voice)
        self.assertIn('if (speakingRef.current && !echoMonitorReadyRef.current)', self.voice)
        self.assertIn('waitForRecognitionToStop().then(beginSpeechQueue)', self.voice)
        self.assertIn('settings.echoCancellation !== true', self.voice)
        self.assertIn('now - voiceStartRef.current >= 180', self.voice)
        self.assertIn('const isLikelySpeechEcho = (transcript, speechTextOverride = "") => {', self.voice)
        self.assertIn('overlap >= 0.82', self.voice)
        self.assertIn('currentUtteranceTextRef.current', self.voice)
        self.assertIn('rawText.trim().replace(/^(?:hey\\s+)?voxora[,. ]+/i, "")', self.voice)

    def test_recognition_start_failure_resets_state(self):
        start_block = self.voice.split('const startListening = () => {', 1)[1].split('const resumeListening', 1)[0]
        self.assertIn('activeRef.current = false', start_block)
        self.assertIn('setActive(false)', start_block)
        self.assertIn('recognitionListeningRef.current = false', start_block)

    def test_stop_listening_ends_the_session_not_only_mutes(self):
        self.assertIn('(mute yourself|mute)', self.voice)
        self.assertNotIn('(mute yourself|mute|stop listening)', self.voice)
        self.assertIn('(stop listening|end voice session)', self.voice)
        self.assertIn('endSession();', self.voice)

    def test_voice_stop_and_mute_commands_normalize_sentence_punctuation(self):
        handler = self.voice.split('const handleVoiceInput = async (rawText) => {', 1)[1].split('const askAssistant', 1)[0]
        self.assertLess(handler.index('const command = text.toLowerCase()'), handler.index('(stop listening|end voice session)'))
        self.assertIn('replace(/[.!?]+$/, "").trim()', handler)
        self.assertIn('(voxora[,. ]+)?(mute yourself|mute)', handler)
        self.assertIn('(voxora[,. ]+)?(stop listening|end voice session)', handler)

    def test_heading_navigation_starts_at_first_heading_and_focuses_before_scroll(self):
        self.assertIn('const headingIndexRef = useRef(-1);', self.voice)
        self.assertIn('headingIndexRef.current = -1', self.voice)
        next_heading = self.voice.split('if (/^(next heading|next section|move to next heading)$/i.test(command))', 1)[1].split('if (/^(previous heading', 1)[0]
        self.assertLess(next_heading.index('setAttribute("tabindex", "-1")'), next_heading.index('heading.focus('))
        self.assertIn('heading.scrollIntoView({ behavior: getScrollBehavior()', next_heading)

    def test_voice_scrolling_respects_reduced_motion(self):
        self.assertIn('window.matchMedia("(prefers-reduced-motion: reduce)").matches', self.voice)
        self.assertIn('? "auto"', self.voice)
        self.assertIn('behavior: getScrollBehavior()', self.voice)
        self.assertNotIn('behavior: "smooth"', self.voice)

    def test_route_changes_focus_the_page_heading(self):
        self.assertIn('heading.setAttribute("tabindex", "-1")', self.app)
        self.assertIn('const focusTarget = heading || main;', self.app)
        self.assertIn('focusTarget?.focus()', self.app)

    def test_workspace_navigation_landmarks_have_distinct_names(self):
        self.assertIn('<nav aria-label="Workspace pages">', self.app)
        self.assertIn('<nav aria-label="Account actions">', self.app)

    def test_workspace_footer_does_not_create_an_empty_navigation_landmark(self):
        self.assertIn('!(isDashboardArea && user) && <nav aria-label="Footer navigation">', self.app)

    def test_scroll_to_top_control_is_positioned_above_voice_dock(self):
        self.assertIn('bottom: calc(var(--voxora-control-dock-height, 7rem) + var(--voxora-control-dock-bottom, 1rem) + 1rem + env(safe-area-inset-bottom));', self.css)
        self.assertIn('root.style.setProperty("--voxora-control-dock-height", `${height}px`)', self.voice)

    def test_upload_file_input_uses_a_wrapping_label_without_unknown_as_attribute(self):
        self.assertIn('<FormField label="Choose a file" name="file" type="file"', self.app)
        self.assertNotIn('<FormField as="input"', self.app)
        self.assertIn('const FormField = ({label,...props}) => <label className="react-field">{label}<input {...props}/></label>;', self.app)

    def test_navigation_and_action_link_targets_meet_wcag_minimum_target_size(self):
        self.assertIn("#voxora-app-root .react-topbar-actions a {\n    display: inline-flex;\n    align-items: center;\n    min-height: 32px;", self.css)
        self.assertIn("#voxora-app-root .react-site-footer a {\n    display: inline-flex;\n    align-items: center;\n    min-height: 32px;", self.css)
        self.assertIn("#voxora-app-root .react-actions a:not(.react-primary-button) {\n    display: inline-flex;\n    align-items: center;\n    min-height: 32px;", self.css)
        self.assertIn("#voxora-app-root .react-content-card > a:last-child {\n    display: inline-flex;\n    align-items: center;\n    min-height: 32px;", self.css)

    def test_browser_accessibility_suite_is_included_in_ci(self):
        workflow = (ROOT / ".github" / "workflows" / "quality.yml").read_text(encoding="utf-8")
        browser_package = (ROOT / "tests" / "browser" / "package.json").read_text(encoding="utf-8")
        browser_tests = (ROOT / "tests" / "browser" / "accessibility.spec.mjs").read_text(encoding="utf-8")
        self.assertIn("Install Chromium for browser tests", workflow)
        self.assertIn("working-directory: tests/browser", workflow)
        self.assertIn("run: npm test", workflow)
        self.assertIn("@axe-core/playwright", browser_package)
        self.assertIn("wcag22aa", browser_tests)
        self.assertIn('expect(dimensions.overflowingElements', browser_tests)
        self.assertIn('Scroll-to-top overlaps voice dock', browser_tests)
        self.assertIn('const signedOutRoutes = [', browser_tests)
        self.assertIn('for (const routePath of signedOutRoutes)', browser_tests)
        self.assertIn('"/accessibility"', browser_tests)
        self.assertIn('"/privacy"', browser_tests)

    def test_browser_fixture_uses_the_production_react_bundle(self):
        fixture = (ROOT / "tests" / "browser" / "fixture.html").read_text(encoding="utf-8")
        browser_tests = (ROOT / "tests" / "browser" / "accessibility.spec.mjs").read_text(encoding="utf-8")
        self.assertIn('/static/dist/app.css', fixture)
        self.assertIn('/static/dist/app.js', fixture)
        self.assertIn('page.route("**/api/site?*"', browser_tests)
        self.assertIn('Voxora controls', browser_tests)

    def test_browser_test_package_is_separate_from_production_dependencies(self):
        production_package = (ROOT / "package.json").read_text(encoding="utf-8")
        self.assertNotIn("@playwright/test", production_package)
        self.assertNotIn("@axe-core/playwright", production_package)

    def test_voice_dock_height_is_measured_and_shared_with_layout(self):
        self.assertIn('new window.ResizeObserver(updateDockHeight)', self.voice)
        self.assertIn('root.style.setProperty("--voxora-control-dock-height", `${height}px`)', self.voice)
        self.assertIn('root.style.removeProperty("--voxora-control-dock-height")', self.voice)
        self.assertIn('var(--voxora-control-dock-height, 7rem)', self.css)
        self.assertIn('var(--voxora-control-dock-bottom, 1rem)', self.css)
        self.assertIn('bottom:calc(var(--voxora-control-dock-bottom, 1rem) + env(safe-area-inset-bottom, 0px)) !important', self.css)
        self.assertIn('bottom:calc(var(--voxora-control-dock-bottom,.45rem) + env(safe-area-inset-bottom))', self.css)
        self.assertIn(':root{--voxora-control-dock-bottom:.45rem;--voxora-control-dock-height:14rem}', self.css)

    def test_scroll_to_top_uses_dock_height_without_footer_spacer(self):
        self.assertIn('bottom: calc(var(--voxora-control-dock-height, 7rem) + var(--voxora-control-dock-bottom, 1rem) + 1rem + env(safe-area-inset-bottom));', self.css)
        self.assertIn('body{padding-bottom:0}', self.css)
        self.assertIn('#voxora-app-root .react-site-footer{', self.css)
        self.assertIn("#voxora-app-root .react-site-footer{padding-bottom:24px}", self.css)
        self.assertNotIn("padding-bottom:calc(24px + var(--voxora-control-dock-height", self.css)
        self.assertNotIn(".voxora-control-dock.is-footer-visible", self.css)
        self.assertNotIn("--voxora-footer-height", self.css)
        self.assertNotIn("footerVisible", self.voice)
        self.assertIn('import { createPortal } from "react-dom";', self.voice)
        self.assertNotIn("voxora-footer-toggle", self.voice)
        self.assertNotIn("dockExpanded", self.voice)
        self.assertNotIn("is-expanded", self.css)
        self.assertIn('className="react-footer-identity"', self.app)
        self.assertIn('src="/static/img/voxora-mark.svg"', self.app)
        self.assertNotIn('body{padding-bottom:calc', self.css)
        self.assertNotIn('bottom: calc(10.25rem + env(safe-area-inset-bottom))', self.css)

    def test_speech_status_tracks_browser_playback_and_reports_failures(self):
        self.assertIn('utterance.onstart = () => {', self.voice)
        self.assertIn('setNotice("Voxora is speaking.")', self.voice)
        self.assertNotIn('ready for interruption', self.voice)
        self.assertNotIn('microphone paused', self.voice)
        self.assertIn('utterance.onerror = (event) => {', self.voice)
        self.assertIn('fail(event?.error || "speech error")', self.voice)
        self.assertIn('speechWatchdogRef.current = window.setTimeout', self.voice)
        self.assertIn('setNotice("Preparing audio…")', self.voice)

    def test_welcome_is_retried_after_autoplay_block_and_replays_on_new_page_load(self):
        self.assertNotIn('WELCOME_SESSION_KEY', self.voice)
        self.assertNotIn('sessionStorage.getItem("voxora-welcomed-session-v1")', self.voice)
        self.assertIn('const welcomeEnabled = window.voxoraWelcomeEnabled !== false', self.voice)
        self.assertNotIn('welcomeAvailable', self.voice)
        self.assertNotIn('setWelcomeAvailable', self.voice)
        self.assertNotIn('voxora-welcome-button', self.voice)
        self.assertNotIn('voxora-test-speaker', self.voice)
        self.assertNotIn('Test speaker', self.voice)
        self.assertNotIn('Play welcome', self.voice)
        self.assertIn('retryPendingSpeechFromGesture', self.voice)
        self.assertIn('welcomePendingRef.current = true', self.voice)
        self.assertIn('classList.contains("voxora-dock-primary")', self.voice)
        self.assertNotIn('voxora-footer-toggle', self.voice)

    def test_document_reading_uses_all_extracted_text_instead_of_a_40k_prefix(self):
        self.assertNotIn("const maxReadCharacters = 40000", self.voice)
        self.assertNotIn("read-aloud currently reads up to the first 40,000", self.app)
        self.assertIn("buildReadingSegments", self.reader_data)
        self.assertIn("segments.length", self.reader_component)
        self.assertIn("nextSegmentIndex: nextIndex", self.voice)

    def test_speech_supports_echo_gated_barge_in_with_half_duplex_fallback(self):
        speech_block = self.voice.split('const speak = (text, options = {}) => {', 1)[1].split('speakRef.current = speak;', 1)[0]
        self.assertIn('speakingRef.current = true', speech_block)
        self.assertIn('const echoAwareBargeIn = echoMonitorReadyRef.current', speech_block)
        self.assertIn('if (recognitionListeningRef.current && !echoAwareBargeIn)', speech_block)
        self.assertIn('waitForRecognitionToStop().then(beginSpeechQueue)', speech_block)
        self.assertIn('resumeListening(echoAwareBargeIn ? 350 : 900)', speech_block)
        self.assertIn('if (!recentUserVoice || isLikelySpeechEcho(transcript)) continue;', self.voice)
        self.assertIn('interruptSpeechRef.current?.({ userBargeIn: true });', self.voice)
        self.assertIn('const microphoneMonitorRef = useRef(', self.voice)
        self.assertIn('settings.echoCancellation !== true', self.voice)
        self.assertIn('recentSpeechSegmentsRef.current', self.voice)
        self.assertNotIn('echoCancellationRef', self.voice)

    def test_microphone_mute_is_independent_of_speech_output(self):
        speak_block = self.voice.split('const speak = (text, options = {}) => {', 1)[1].split('speakRef.current = speak;', 1)[0]
        mute_block = self.voice.split('const mute = () => {', 1)[1].split('const endSession', 1)[0]
        self.assertIn('synthesis.speak(utterance)', speak_block)
        self.assertNotIn('if (mutedRef.current) return', speak_block)
        self.assertIn('Microphone mute affects input only. It must never disable speaker output.', speak_block)
        self.assertNotIn('interruptSpeech()', mute_block)
        self.assertIn('setNotice("Microphone muted.")', mute_block)

    def test_voice_controls_hide_internal_audio_and_provider_details(self):
        self.assertNotIn("ready for interruption", self.voice.lower())
        self.assertNotIn("echo-aware listening", self.voice.lower())
        self.assertNotIn("ai cooldown", self.voice.lower())
        self.assertNotIn("groq did not provide", self.voice.lower())
        self.assertNotIn("voxora-footer-toggle", self.voice)

    def test_microphone_permission_is_requested_only_after_a_user_action(self):
        self.assertNotIn('setTimeout(() => startListening(), 500)', self.voice)
        self.assertIn('permission?.state === "granted"', self.voice)
        self.assertIn('onClick={() => (muted || !active) ? startListening() : mute()}', self.voice)
        self.assertIn('className="voxora-dock-primary voxora-microphone-toggle"', self.voice)


if __name__ == "__main__":
    unittest.main()
