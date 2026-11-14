export const nav = [
    ["/", "Explore"], ["/about", "About"], ["/how-it-works", "How it works"],
    ["/accessibility", "Accessibility"], ["/contact", "Contact"],
];
export const accountNav = [
    ["/dashboard", "Dashboard"], ["/upload", "Upload"], ["/my-resources", "My uploads"],
    ["/library", "My Library"], ["/shared-with-me", "Shared with me"], ["/preferences", "Preferences"],
];
export const legal = [["/privacy", "Privacy"], ["/terms", "Terms"], ["/cookies", "Cookies"], ["/acceptable-use", "Acceptable use"], ["/copyright", "Copyright"]];
export function normalizeVoiceText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
