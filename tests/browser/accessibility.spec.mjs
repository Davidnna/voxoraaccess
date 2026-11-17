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

async function preparePage(page, routePath = "/", signedOut = false) {
    await page.addInitScript(() => {
        localStorage.setItem("voxora-welcomed-v1", "1");
        class TestSpeechRecognition {
            start() { this.started = true; }
            stop() {
                this.started = false;
                if (typeof this.onend === "function") this.onend();
            }
        }
        window.SpeechRecognition = TestSpeechRecognition;
        window.webkitSpeechRecognition = TestSpeechRecognition;
        window.SpeechSynthesisUtterance = class {
            constructor(text) { this.text = text; }
        };
        window.speechSynthesis = {
            cancel() {},
            speak(utterance) {
                if (typeof utterance.onend === "function") {
                    window.setTimeout(() => utterance.onend(), 0);
                }
            },
        };
        try {
            Object.defineProperty(navigator, "mediaDevices", {
                configurable: true,
                value: {
                    getUserMedia: async () => {
                        throw new DOMException("Microphone permission denied in test", "NotAllowedError");
                    },
                },
            });
        } catch (_) {}
    });

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
    await page.goto(`/tests/browser/fixture.html?route=${encodeURIComponent(routePath)}${signedOutParam}`);
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
        const controls = page.getByRole("region", { name: "Voxora controls" });
        await expect(controls).toBeVisible();
        const mute = controls.getByRole("button", { name: "Mute microphone" });
        const stop = controls.getByRole("button", { name: "Stop speaking" });
        const pause = controls.getByRole("button", { name: "Pause access" });
        await expect(mute).toBeVisible();
        await expect(stop).toBeVisible();
        await expect(pause).toBeVisible();
        await mute.click();
        await expect(mute).toHaveAttribute("aria-pressed", "true");
        await pause.click();
        await expect(controls.getByRole("button", { name: "Resume access" })).toBeVisible();
        await expect(controls.getByRole("status")).toContainText("Voice access paused");
    });

    test("document preview has a title and a non-embedded alternative", async ({ page }) => {
        await preparePage(page, "/resource/41");
        await expect(page.getByTitle("PDF preview of PDF: Accessible sample resource")).toBeVisible();
        await expect(page.getByRole("link", { name: "Open preview in a new tab" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Download original" }).first()).toBeVisible();
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
            expect(spacing.bodyPadding).toBeGreaterThanOrEqual(spacing.dockHeight + spacing.dockBottom + 16);
            await expect(page.getByRole("region", { name: "Voxora controls" })).toBeVisible();
        });
    }
});
