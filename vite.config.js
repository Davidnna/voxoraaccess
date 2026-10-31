import { defineConfig } from "vite";

export default defineConfig({
    base: "/static/dist/",
    build: {
        outDir: "static/dist",
        emptyOutDir: true,
        rollupOptions: {
            output: {
                entryFileNames: "app.js",
                assetFileNames: (asset) =>
                    asset.name?.endsWith(".css") ? "app.css" : "assets/[name]-[hash][extname]",
                chunkFileNames: "assets/[name]-[hash].js",
            },
        },
    },
});
