import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: ".",
    testMatch: "accessibility.spec.mjs",
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL: "http://127.0.0.1:4173",
        browserName: "chromium",
        viewport: { width: 1365, height: 900 },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: {
        command: "python -m http.server 4173 --bind 127.0.0.1 --directory ../..",
        url: "http://127.0.0.1:4173/tests/browser/fixture.html",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
