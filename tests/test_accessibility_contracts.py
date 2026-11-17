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
        cls.voice = (
            ROOT / "src" / "components" / "VoiceAssistant.jsx"
        ).read_text(encoding="utf-8")
        cls.css = (ROOT / "src" / "dashboard.css").read_text(encoding="utf-8")
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

    def test_document_preview_has_named_frame_and_new_tab_alternative(self):
        self.assertIn('className="react-document-frame"', self.app)
        self.assertIn('title={(isPdf?', self.app)
        self.assertIn('aria-describedby="document-preview-help"', self.app)
        self.assertIn('target="_blank" rel="noopener noreferrer"', self.app)
        self.assertIn('Open preview in a new tab', self.app)
        self.assertIn('scanned pages may require OCR', self.app)

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

    def test_voice_controls_have_accessible_names_and_toggle_state(self):
        self.assertIn('role="region" aria-label="Voxora controls"', self.voice)
        self.assertIn('aria-pressed={muted}', self.voice)
        self.assertIn('>Mute microphone</button>', self.voice)
        self.assertIn('> Stop speaking</button>', self.voice)
        self.assertIn('> {active ? "Pause access" : "Resume access"}</button>', self.voice)
        self.assertIn('<span aria-hidden="true">🎙</span>', self.voice)

    def test_voice_status_does_not_announce_each_cooldown_second(self):
        self.assertIn('role="status" aria-live="polite" aria-atomic="true"', self.voice)
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

    def test_microphone_permission_failure_releases_audio_resources(self):
        error_handler = self.voice.split('recognition.onerror = (event) => {', 1)[1].split('recognition.onend =', 1)[0]
        self.assertIn('event.error === "not-allowed"', error_handler)
        self.assertIn('event.error === "service-not-allowed"', error_handler)
        self.assertIn('recognitionRef.current?.stop()', error_handler)
        self.assertIn('releaseAudioMonitor()', error_handler)
        self.assertIn('setActive(false)', error_handler)

    def test_missing_microphone_releases_audio_resources(self):
        error_handler = self.voice.split('recognition.onerror = (event) => {', 1)[1].split('recognition.onend =', 1)[0]
        audio_error = error_handler.split('event.error === "audio-capture"', 1)[1]
        self.assertIn('releaseAudioMonitor()', audio_error)
        self.assertIn('setActive(false)', audio_error)

    def test_recognition_start_failure_resets_state_and_releases_audio(self):
        start_block = self.voice.split('recognitionRef.current.start();', 1)[1].split('const resumeListening', 1)[0]
        self.assertIn('activeRef.current = false', start_block)
        self.assertIn('setActive(false)', start_block)
        self.assertIn('releaseAudioMonitor()', start_block)

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
        self.assertIn('bottom: calc(8.5rem + env(safe-area-inset-bottom));', self.css)
        self.assertIn('bottom: calc(10.25rem + env(safe-area-inset-bottom));', self.css)

    def test_upload_file_input_uses_a_wrapping_label_without_unknown_as_attribute(self):
        self.assertIn('<FormField label="Choose a file" name="file" type="file"', self.app)
        self.assertNotIn('<FormField as="input"', self.app)
        self.assertIn('const FormField = ({label,...props}) => <label className="react-field">{label}<input {...props}/></label>;', self.app)


if __name__ == "__main__":
    unittest.main()
