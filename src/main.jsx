import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./dashboard.css";

const workspaceLinks = [
    ["Overview", "/dashboard", "⌂"],
    ["Explore resources", "/#resources", "⌕"],
    ["Upload a resource", "/upload", "＋"],
    ["My uploads", "/my-resources", "▤"],
    ["My Library", "/library", "▣"],
    ["Shared with me", "/shared-with-me", "⇄"],
    ["Preferences", "/preferences", "⚙"],
];

function Header({ user }) {
    return (
        <header className="react-topbar">
            <a className="react-brand" href="/">
                <span className="react-brand-mark">V</span>
                <span className="react-brand-copy">
                    <strong>Voxora Access</strong>
                    <small>Knowledge within everyone's reach.</small>
                </span>
            </a>
            <div className="react-topbar-actions">
                <a href="/about">About</a>
                <a href="/how-it-works">How it works</a>
                <a href="/accessibility">Accessibility</a>
                <span className="react-user">{user.name}</span>
                <form method="post" action="/signout">
                    <input type="hidden" name="_csrf_token" value={window.voxoraCsrf || ""} />
                    <button className="react-signout" type="submit">Sign out</button>
                </form>
            </div>
        </header>
    );
}

function ResourceList({ items, empty, action }) {
    return items.length ? (
        <div className="react-resource-list">
            {items.map((item) => (
                <article className="react-resource" key={item.id}>
                    <span className="react-filetype">{(item.extension || "FILE").toUpperCase()}</span>
                    <div className="react-resource-info">
                        <a href={"/resource/" + item.id}>{item.title}</a>
                        {item.visibility && <small>{item.visibility} resource</small>}
                    </div>
                    <a className="react-open-link" href={"/resource/" + item.id}>Open ↗</a>
                </article>
            ))}
            {action && <a className="react-panel-link" href={action.href}>{action.label} →</a>}
        </div>
    ) : <div className="react-empty">{empty}</div>;
}

function Dashboard() {
    const [data, setData] = useState(null);
    const [error, setError] = useState("");

    useEffect(() => {
        fetch("/api/dashboard", { headers: { Accept: "application/json" } })
            .then((response) => {
                if (!response.ok) throw new Error("We couldn't load your dashboard.");
                return response.json();
            })
            .then(setData)
            .catch((err) => setError(err.message));
    }, []);

    if (error) {
        return <main className="react-dashboard-main"><div className="react-error" role="alert">{error} <button onClick={() => window.location.reload()}>Try again</button></div></main>;
    }
    if (!data) {
        return <main className="react-dashboard-main"><div className="react-loading" role="status">Loading your dashboard…</div></main>;
    }

    const stats = [
        ["Your uploads", data.stats.uploads, "Documents you've added"],
        ["Public resources", data.stats.public, "Visible to the community"],
        ["Saved in library", data.stats.saved, "Resources kept for later"],
        ["Shared with you", data.stats.shared, "Resources others shared"],
    ];

    return (
        <>
            <Header user={data.user} />
            <div className="react-dashboard-layout">
                <aside className="react-sidebar">
                    <div className="react-sidebar-label">YOUR WORKSPACE</div>
                    <nav aria-label="Dashboard navigation">
                        {workspaceLinks.map(([label, href, icon], index) => (
                            <a key={href} className={index === 0 ? "active" : ""} href={href}>
                                <span aria-hidden="true">{icon}</span>{label}
                            </a>
                        ))}
                    </nav>
                    <div className="react-sidebar-divider" />
                    <div className="react-sidebar-label">PUBLIC INFORMATION</div>
                    <nav aria-label="Public information">
                        <a href="/about"><span aria-hidden="true">ⓘ</span>About Voxora</a>
                        <a href="/how-it-works"><span aria-hidden="true">⌁</span>How it works</a>
                        <a href="/accessibility"><span aria-hidden="true">◎</span>Accessibility</a>
                        <a href="/contact"><span aria-hidden="true">✉</span>Contact support</a>
                    </nav>
                    <div className="react-sidebar-footer">Listen. Learn. Explore. Achieve.</div>
                </aside>

                <main className="react-dashboard-main">
                    <div className="react-welcome">
                        <div>
                            <p className="react-eyebrow">YOUR LEARNING SPACE</p>
                            <h1>Welcome back, {data.user.name.split(" ")[0]}.</h1>
                            <p>Pick up where you left off or add something new to your library.</p>
                        </div>
                        <a className="react-primary-button" href="/upload">＋ Upload a resource</a>
                    </div>

                    <section className="react-stats" aria-label="Your activity summary">
                        {stats.map(([label, value, note]) => (
                            <article className="react-stat" key={label}>
                                <span>{label}</span><strong>{value}</strong><small>{note}</small>
                            </article>
                        ))}
                    </section>

                    <div className="react-panels">
                        <section className="react-panel">
                            <div className="react-panel-heading">
                                <div><p className="react-eyebrow">YOUR CONTENT</p><h2>Recent uploads</h2></div>
                                <a href="/my-resources">View all →</a>
                            </div>
                            <ResourceList items={data.recent} empty="You haven't uploaded a resource yet." action={{ href: "/upload", label: "Upload your first resource" }} />
                        </section>
                        <section className="react-panel">
                            <div className="react-panel-heading">
                                <div><p className="react-eyebrow">YOUR COLLECTION</p><h2>Saved for later</h2></div>
                                <a href="/library">My Library →</a>
                            </div>
                            <ResourceList items={data.saved} empty="Your library is waiting for its first resource." action={{ href: "/#resources", label: "Explore public resources" }} />
                        </section>
                    </div>

                    <section className="react-quick-actions">
                        <div>
                            <p className="react-eyebrow">MAKE A MOVE</p>
                            <h2>Quick actions</h2>
                            <p>Everything you need to keep learning moving.</p>
                        </div>
                        <div className="react-action-list">
                            <a href="/upload">Upload learning material <span>↗</span></a>
                            <a href="/#resources">Discover public resources <span>↗</span></a>
                            <a href="/shared-with-me">Open shared resources <span>↗</span></a>
                        </div>
                    </section>
                    <footer className="react-dashboard-footer">
                        <span>© {new Date().getFullYear()} Voxora Access</span>
                        <div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/cookies">Cookies</a><a href="/copyright">Copyright</a></div>
                    </footer>
                </main>
            </div>
        </>
    );
}

const root = document.getElementById("voxora-dashboard-root");
if (root) createRoot(root).render(<Dashboard />);
