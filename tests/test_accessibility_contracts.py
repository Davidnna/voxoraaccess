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


if __name__ == "__main__":
    unittest.main()
