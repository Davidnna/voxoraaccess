import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const demoUser = {
    id: 7,
    name: "Accessibility Test Student",
    email: "student@example.test",
};

const routes = [
    "/",
    "/about",
    "/how-it-works",
    "/accessibility",
    "/contact",
    "/privacy",
    "/terms",
    "/cookies",
    "/acceptable-use",
    "/copyright",
    "/signin",
    "/register",
    "/dashboard",
    "/upload",
    "/my-resources",
    "/library",
    "/shared-with-me",
    "/preferences",
    "/account",
    "/resource/41",
    "/resource/41/read",
];

const signedOutRoutes = [
    "/", "/about", "/how-it-works", "/accessibility", "/contact",
    "/privacy", "/terms", "/cookies", "/acceptable-use", "/copyright",
    "/signin", "/register",
];

async function expandVoiceDock(page) {
    const controls = page.getByRole("region", { name: "Voxora controls" });
    const expand = controls.getByRole("button", { name: "Voxora controls" });
    if (await expand.count()) await expand.click();
    return controls;
}

async function preparePage(page, routePath = "/", signedOut = false, options = {}) {
    await page.addInitScript(({ speechBehavior, welcome }) => {
        window.voxoraWelcomeEnabled = Boolean(welcome);
        window.__voxoraRecognitionInstances = [];
        class TestSpeechRecognition {
            constructor() {
                this.started = false;
                window.__voxoraRecognitionInstances.push(this);
            }
            start() {
                if (this.started) throw new DOMException("Recognition already started", "InvalidStateError");
                this.started = true;
                this.onstart?.();
            }
            stop() {
                this.started = false;
                this.onend?.();
            }
            abort() {
                this.started = false;
                this.onend?.();
            }
            emit(transcript) {
                const result = [{ transcript }];
                result.isFinal = true;
                this.onresult?.({ resultIndex: 0, results: [result] });
            }
        }
        window.SpeechRecognition = TestSpeechRecognition;
        window.webkitSpeechRecognition = TestSpeechRecognition;
        window.__voxoraSpeechOutput = [];
        window.__voxoraSpeechCallCount = 0;
        window.__voxoraSpeechRecognitionWasActiveAtSpeech = [];
        window.__voxoraSpeechCancelCount = 0;
        window.__voxoraMicLevel = 0.002;
        window.__voxoraGetUserMediaConstraints = null;
        class TestAudioAnalyser {
            constructor() { this.fftSize = 2048; this.smoothingTimeConstant = 0; }
            getFloatTimeDomainData(target) {
                for (let index = 0; index < target.length; index += 1) {
                    target[index] = Math.sin(index * 2 * Math.PI * 300 / 48000) * window.__voxoraMicLevel;
                }
            }
            disconnect() {}
        }
        class TestAudioContext {
            constructor() { this.state = "running"; }
            createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
            createAnalyser() { return new TestAudioAnalyser(); }
            resume() { this.state = "running"; return Promise.resolve(); }
            close() { this.state = "closed"; return Promise.resolve(); }
        }
        window.AudioContext = TestAudioContext;
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
                getUserMedia: async (constraints) => {
                    window.__voxoraGetUserMediaConstraints = constraints;
                    const track = { getSettings: () => ({ echoCancellation: true }), stop() {} };
                    return { getAudioTracks: () => [track], getTracks: () => [track] };
                },
            },
        });
        window.__voxoraReleaseSpeech = null;
        window.__voxoraSpeechBehavior = speechBehavior || "success";
        window.SpeechSynthesisUtterance = class {
            constructor(text) { this.text = text; }
        };
        window.speechSynthesis = {
            cancel() { window.__voxoraSpeechCancelCount += 1; },
            resume() {},
            getVoices() { return [{ name: "Test English", lang: "en-US", default: true }]; },
            speak(utterance) {
                window.__voxoraSpeechOutput.push(utterance.text);
                window.__voxoraSpeechCallCount += 1;
                window.__voxoraSpeechRecognitionWasActiveAtSpeech.push(
                    window.__voxoraRecognitionInstances.some((recognition) => recognition.started)
                );
                const callNumber = window.__voxoraSpeechCallCount;
                const behavior = window.__voxoraSpeechBehavior;
                window.setTimeout(() => {
                    if (behavior === "blocked" || (behavior === "blocked-once" && callNumber === 1)) {
                        utterance.onerror?.({ error: "not-allowed" });
                        return;
                    }
                    utterance.onstart?.();
                    if (behavior === "hold") {
                        window.__voxoraReleaseSpeech = () => utterance.onend?.();
                        return;
                    }
                    window.setTimeout(() => utterance.onend?.(), 40);
                }, 0);
            },
        };
    }, { speechBehavior: options.speechBehavior || "success", welcome: Boolean(options.welcome) });

    await page.route("**/api/site?*", async (route) => {
        const url = new URL(route.request().url());
        const path = url.searchParams.get("path") || "/";
        const payload = {
            path,
            user: signedOut ? null : demoUser,
            csrf: "browser-test-csrf-token",
            resources: [],
            resource: null,
            dashboard: null,
        };

        if (path === "/dashboard") {
            payload.dashboard = {
                user: { name: demoUser.name, email: demoUser.email },
                stats: { uploads: 2, public: 1, saved: 3, shared: 1 },
                recent: [],
                saved: [],
            };
        }

        if (/^\/resource\/41(?:\/read)?$/.test(path)) {
            payload.resource = {
                id: 41,
                title: "Accessible sample resource",
                description: "A sample document used by automated accessibility tests.",
                extension: "pdf",
                size_bytes: 1024,
                visibility: "private",
                owner_id: demoUser.id,
                owner_name: demoUser.name,
                text_excerpt: "A short sample document for browser testing.",
                text_truncated: false,
                reading_text: path.endsWith("/read") ? "Introduction\n\nA sample passage for assistive reading.\n\nFirst point\n\nSecond point\n\nTerm | Meaning\nAccess | Ability to use information" : undefined,
                reading_truncated: false,
                reading_blocks: path.endsWith("/read") ? [
                    { type: "heading", level: 2, text: "Introduction" },
                    { type: "paragraph", text: "A sample passage for assistive reading." },
                    { type: "list_item", ordered: false, text: "First point" },
                    { type: "list_item", ordered: false, text: "Second point" },
                    { type: "table", caption: "Key terms", header_rows: 1, rows: [["Term", "Meaning"], ["Access", "Ability to use information"]] },
                ] : [],
                extraction_status: options.extractionStatus || "partial",
                extraction_method: "pypdf+ocr",
                extraction_warnings: ["The source PDF tag order has not been independently verified."],
                extraction_truncated: false,
                preview_available: true,
                page_count: 1,
                is_owner: true,
                in_library: false,
            };
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Cache-Control": "private, no-store" },
            body: JSON.stringify(payload),
        });
    });

    await page.route("**/resource/41/preview", async (route) => {
        const minimalPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
        await route.fulfill({
            status: 200,
            contentType: "application/pdf",
            body: Buffer.from(minimalPdf),
        });
    });

    const signedOutParam = signedOut ? "&signedOut=1" : "";
    const welcomeParam = options.welcome ? "&welcome=1" : "";
    await page.goto(`/tests/browser/fixture.html?route=${encodeURIComponent(routePath)}${signedOutParam}${welcomeParam}`);
    await expect(page.locator("#main-content h1")).toBeVisible();
    await expect(page.locator("#main-content")).toHaveAttribute("aria-busy", "false");
}

test.describe("Voxora browser accessibility", () => {
    for (const routePath of routes) {
        test(`axe WCAG 2.2 AA audit: ${routePath}`, async ({ page }) => {
            await preparePage(page, routePath);
            const results = await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
                .analyze();

            const violations = results.violations.map((violation) => ({
                id: violation.id,
                impact: violation.impact,
                description: violation.description,
                nodes: violation.nodes.map((node) => ({
                    target: node.target,
                    summary: node.failureSummary,
                })),
            }));
            expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
        });
    }

    for (const routePath of signedOutRoutes) {
        test(`axe WCAG 2.2 AA audit for signed-out state: ${routePath}`, async ({ page }) => {
            await preparePage(page, routePath, true);
            const results = await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
                .analyze();
            const violations = results.violations.map((violation) => ({
                id: violation.id,
                impact: violation.impact,
                nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
            }));
            expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
        });
    }

    test("skip link moves keyboard focus to the main landmark", async ({ page }) => {
        await preparePage(page, "/");
        const skipLink = page.getByRole("link", { name: "Skip to main content" });
        await skipLink.focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#main-content")).toBeFocused();
    });

    test("client-side navigation moves focus to the new page heading", async ({ page }) => {
        await preparePage(page, "/");
        await page.getByRole("navigation", { name: "Main navigation" })
            .getByRole("link", { name: "About" }).click();
        await expect(page.locator("#main-content h1")).toHaveText(
            "Learning resources should be easier to find, use and revisit."
        );
        await expect(page.locator("#main-content h1")).toBeFocused();
    });

    test("voice controls remain named, visible and stateful", async ({ page }) => {
        await preparePage(page, "/about");
        const controls = await expandVoiceDock(page);
        await expect(controls).toBeVisible();
        const enable = controls.getByRole("button", { name: "Enable microphone" });
        const stop = controls.getByRole("button", { name: "Stop speaking" });
        await expect(enable).toBeVisible();
        await expect(stop).toBeVisible();
        await expect(controls.getByRole("button", { name: "Test speaker" })).toHaveCount(0);
        await expect(controls.getByRole("button", { name: "Play welcome" })).toHaveCount(0);
        await enable.click();
        const mute = controls.getByRole("button", { name: "Mute microphone" });
        await expect(mute).toHaveAttribute("aria-pressed", "true");
        await mute.click();
        const unmute = controls.getByRole("button", { name: "Unmute microphone" });
        await expect(unmute).toHaveAttribute("aria-pressed", "false");
        await unmute.click();
        await expect(controls.getByRole("button", { name: "Mute microphone" })).toHaveAttribute("aria-pressed", "true");
        await expect(controls.getByRole("button", { name: "Pause access" })).toBeVisible();
    });

    test("Voxora ignores uncorroborated speaker echo but can be interrupted by user speech", async ({ page }) => {
        await preparePage(page, "/resource/41/read", false, { speechBehavior: "hold" });
        const controls = await expandVoiceDock(page);
        await controls.getByRole("button", { name: "Enable microphone" }).click();
        await expect.poll(() => page.evaluate(() => window.__voxoraRecognitionInstances.at(-1)?.started)).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__voxoraGetUserMediaConstraints?.audio?.echoCancellation)).toBe(true);
        await page.waitForTimeout(100);

        await page.getByRole("button", { name: "Read aloud with Voxora" }).click();
        await page.waitForFunction(() => window.__voxoraSpeechCallCount === 1 && window.__voxoraReleaseSpeech);
        const recognitionAtPlayback = await page.evaluate(() => ({
            activeAtSpeechStart: window.__voxoraSpeechRecognitionWasActiveAtSpeech[0],
            currentlyListening: window.__voxoraRecognitionInstances.at(-1)?.started,
        }));
        expect(recognitionAtPlayback).toEqual({ activeAtSpeechStart: true, currentlyListening: true });
        await expect(controls.getByRole("status").first()).toContainText("Speaking · ready for interruption");

        // A recognition transcript that resembles a command is ignored unless
        // the echo-cancelled monitor detects a real near-end voice signal.
        await page.evaluate(() => window.__voxoraRecognitionInstances.at(-1)?.emit("go to dashboard"));
        await expect(page).toHaveURL(/\/resource\/41\/read$/);

        await page.evaluate(() => { window.__voxoraMicLevel = 0.08; });
        await page.waitForTimeout(180);
        await page.evaluate(() => window.__voxoraRecognitionInstances.at(-1)?.emit("go to dashboard"));
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect.poll(() => page.evaluate(() => window.__voxoraSpeechCancelCount)).toBeGreaterThan(0);
    });

    test("a spoken stop command interrupts Voxora without requiring the dock button", async ({ page }) => {
        await preparePage(page, "/resource/41/read", false, { speechBehavior: "hold" });
        const controls = await expandVoiceDock(page);
        await controls.getByRole("button", { name: "Enable microphone" }).click();
        await expect.poll(() => page.evaluate(() => window.__voxoraRecognitionInstances.at(-1)?.started)).toBe(true);
        await page.getByRole("button", { name: "Read aloud with Voxora" }).click();
        await page.waitForFunction(() => window.__voxoraSpeechCallCount === 1 && window.__voxoraReleaseSpeech);
        await page.evaluate(() => { window.__voxoraMicLevel = 0.08; });
        await page.waitForTimeout(180);
        await page.evaluate(() => window.__voxoraRecognitionInstances.at(-1)?.emit("stop"));
        await expect.poll(() => page.evaluate(() => window.__voxoraSpeechCancelCount)).toBeGreaterThan(0);
        await expect(controls.getByRole("status").first()).not.toContainText("Speaking");
    });

    test("welcome retries after the browser blocks automatic speech until a user gesture", async ({ page }) => {
        await preparePage(page, "/", false, { welcome: true, speechBehavior: "blocked-once" });
        await page.waitForFunction(() => window.__voxoraSpeechCallCount === 1);
        await expect(page.getByRole("status").filter({ hasText: "Voxora could not start the welcome audio automatically" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Voxora controls" }).getByRole("status")).not.toContainText("Speaking");
        await page.locator("#main-content h1").click();
        await expect(page.getByRole("button", { name: "Play welcome" })).toHaveCount(0);
        const spoken = await page.evaluate(() => window.__voxoraSpeechOutput);
        expect(spoken).toHaveLength(2);
        expect(spoken[0]).toContain("Hello, welcome to Voxora Access");
        expect(spoken[1]).toContain("Hello, welcome to Voxora Access");
    });

    test("compact footer controls do not expose a welcome action and retry welcome on a normal control interaction", async ({ page }) => {
        await preparePage(page, "/about", false, { welcome: true, speechBehavior: "blocked-once" });
        await page.waitForFunction(() => window.__voxoraSpeechCallCount === 1);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const controlsToggle = page.getByRole("button", { name: "Voxora controls" });
        await expect(controlsToggle).toBeVisible();
        await expect(page.getByRole("button", { name: "Play welcome" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Test speaker" })).toHaveCount(0);
        await controlsToggle.click();
        await page.waitForFunction(() => window.__voxoraSpeechCallCount === 2);
        await expect(page.getByRole("button", { name: "Collapse controls" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Play welcome" })).toHaveCount(0);
    });

    test("welcome is attempted again after a full site reload in the same tab", async ({ page }) => {
        await preparePage(page, "/", false, { welcome: true });
        await page.waitForFunction(() => window.__voxoraSpeechOutput.some(text => text.includes("Hello, welcome to Voxora Access")));
        await expect(page.getByRole("button", { name: "Play welcome" })).toHaveCount(0);
        await page.reload();
        await page.waitForFunction(() => window.__voxoraSpeechOutput.some(text => text.includes("Hello, welcome to Voxora Access")));
    });

    test("microphone mute does not silence Voxora's spoken document output", async ({ page }) => {
        await preparePage(page, "/resource/41/read");
        const controls = await expandVoiceDock(page);
        await controls.getByRole("button", { name: "Enable microphone" }).click();
        await controls.getByRole("button", { name: "Mute microphone" }).click();
        await expect(controls.getByRole("button", { name: "Unmute microphone" })).toHaveAttribute("aria-pressed", "false");
        await page.getByRole("button", { name: "Read aloud with Voxora" }).click();
        await page.waitForFunction(() => window.__voxoraSpeechOutput.some(text => text.includes("A sample passage for assistive reading")));
        const spoken = await page.evaluate(() => window.__voxoraSpeechOutput.join(" "));
        expect(spoken).toContain("A sample passage for assistive reading");
    });

    test("footer has no trailing body spacer and the dock collapses at the footer", async ({ page }) => {
        await preparePage(page, "/about");
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.locator(".voxora-control-dock")).toHaveClass(/is-footer-visible/);
        await expect(page.getByRole("button", { name: "Voxora controls" })).toBeVisible();
        await page.getByRole("button", { name: "Voxora controls" }).click();
        await expect(page.getByRole("button", { name: "Collapse controls" })).toBeVisible();
        const metrics = await page.evaluate(() => ({
            bodyPadding: getComputedStyle(document.body).paddingBottom,
            footerBottom: document.querySelector(".react-site-footer").getBoundingClientRect().bottom + window.scrollY,
            documentHeight: document.documentElement.scrollHeight,
        }));
        expect(metrics.bodyPadding).toBe("0px");
        expect(Math.abs(metrics.documentHeight - metrics.footerBottom)).toBeLessThanOrEqual(2);
    });

    test("document preview has a title and a non-embedded alternative", async ({ page }) => {
        await preparePage(page, "/resource/41");
        await expect(page.getByTitle("PDF preview of PDF: Accessible sample resource")).toBeVisible();
        await expect(page.getByRole("link", { name: "Open preview in a new tab" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Download original" }).first()).toBeVisible();
    });

    test("accessible reading view preserves headings, lists and table headers", async ({ page }) => {
        await preparePage(page, "/resource/41/read");
        await expect(page.getByRole("heading", { level: 1, name: "Accessible sample resource" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Introduction" })).toBeVisible();
        await expect(page.getByRole("list")).toBeVisible();
        await expect(page.getByRole("table", { name: "Key terms" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "Term" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Read aloud with Voxora" })).toBeEnabled();
        await expect(page.getByRole("slider", { name: "Text size" })).toBeVisible();
    });

    test("accessible reading view explains extraction limitations and links to the original", async ({ page }) => {
        await preparePage(page, "/resource/41/read");
        await expect(page.getByRole("heading", { name: "Text extracted with limitations" })).toBeVisible();
        await expect(page.getByText("The source PDF tag order has not been independently verified.")).toBeVisible();
        await expect(page.getByRole("link", { name: "Download original" })).toBeVisible();
    });

    test("reader buttons send document text to Voxora speech and can stop it", async ({ page }) => {
        await preparePage(page, "/resource/41/read");
        await page.getByRole("button", { name: "Read aloud with Voxora" }).click();
        await expect.poll(() => page.evaluate(() => window.__voxoraSpeechOutput.join(" ")))
            .toContain("A sample passage for assistive reading.");
        await page.getByRole("button", { name: "Stop reading" }).click();
        await expect(page.locator(".voxora-assistant-notice")).toContainText("Document reading stopped.");
    });

    test("document text scaling reflows without page-level horizontal overflow", async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 900 });
        await preparePage(page, "/resource/41/read");
        const slider = page.getByRole("slider", { name: "Text size" });
        await slider.focus();
        await page.keyboard.press("End");
        await expect(slider).toHaveValue("180");
        const dimensions = await page.evaluate(() => ({
            viewport: document.documentElement.clientWidth,
            document: document.documentElement.scrollWidth,
        }));
        expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
    });

    test("resource owner can refresh accessible text for an already processed document", async ({ page }) => {
        await preparePage(page, "/resource/41", false, { extractionStatus: "ready" });
        await expect(page.getByRole("button", { name: "Refresh accessible text" })).toBeVisible();
    });

    test("resource owner can retry accessible text extraction", async ({ page }) => {
        await preparePage(page, "/resource/41");
        await page.route("**/api/resource/41/extract", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    status: "ready",
                    message: "Accessible reading text is ready. Review any document notes before relying on it.",
                    warnings: [],
                }),
            });
        });
        await page.getByRole("button", { name: "Prepare / retry accessible text" }).click();
        await expect(page.getByRole("status").filter({ hasText: "Accessible reading text is ready" })).toBeVisible();
    });

    test("forms expose accessible labels", async ({ page }) => {
        await preparePage(page, "/signin");
        await expect(page.getByLabel("Email")).toBeVisible();
        await expect(page.getByLabel("Password")).toBeVisible();
        await preparePage(page, "/upload");
        await expect(page.getByLabel("Choose a file")).toBeVisible();
        await expect(page.getByLabel("Resource title")).toBeVisible();
        await expect(page.getByLabel("Short description")).toBeVisible();
    });

    for (const width of [320, 360, 390, 768, 1024, 1365]) {
        test(`no horizontal page overflow at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await preparePage(page, "/dashboard");
            const dimensions = await page.evaluate(() => {
                const viewport = document.documentElement.clientWidth;
                const overflowingElements = Array.from(document.querySelectorAll("#voxora-app-root *"))
                    .filter((element) => {
                        const rect = element.getBoundingClientRect();
                        const style = getComputedStyle(element);
                        return rect.width > 0 && rect.height > 0 &&
                            style.display !== "none" && style.visibility !== "hidden" &&
                            (rect.left < -1 || rect.right > viewport + 1);
                    })
                    .map((element) => ({
                        tag: element.tagName.toLowerCase(),
                        className: typeof element.className === "string" ? element.className : "",
                        left: Math.round(element.getBoundingClientRect().left),
                        right: Math.round(element.getBoundingClientRect().right),
                    }));
                return {
                    viewport,
                    document: document.documentElement.scrollWidth,
                    overflowingElements,
                };
            });
            expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
            expect(dimensions.overflowingElements, JSON.stringify(dimensions.overflowingElements)).toEqual([]);
            const dock = await page.locator(".voxora-control-dock").boundingBox();
            const scrollTop = await page.locator(".react-scroll-top").boundingBox();
            expect(scrollTop.y + scrollTop.height, `Scroll-to-top overlaps voice dock at ${width}px`).toBeLessThanOrEqual(dock.y - 4);
            const spacing = await page.evaluate(() => ({
                dockHeight: document.querySelector(".voxora-control-dock").getBoundingClientRect().height,
                dockBottom: parseFloat(getComputedStyle(document.querySelector(".voxora-control-dock")).bottom),
                bodyPadding: parseFloat(getComputedStyle(document.body).paddingBottom),
            }));
            expect(spacing.bodyPadding).toBe(0);
            await expect(page.getByRole("region", { name: "Voxora controls" })).toBeVisible();
        });
    }
});
