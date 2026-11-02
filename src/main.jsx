import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import "./dashboard.css";

const nav = [
    ["/", "Explore"], ["/about", "About"], ["/how-it-works", "How it works"],
    ["/accessibility", "Accessibility"], ["/contact", "Contact"],
];
const accountNav = [
    ["/dashboard", "Dashboard"], ["/upload", "Upload"], ["/my-resources", "My uploads"],
    ["/library", "My Library"], ["/shared-with-me", "Shared with me"], ["/preferences", "Preferences"],
];
const legal = [["/privacy", "Privacy"], ["/terms", "Terms"], ["/cookies", "Cookies"], ["/acceptable-use", "Acceptable use"], ["/copyright", "Copyright"]];
const pageCopy = {
    "/about": ["About Voxora Access", "Learning resources should be easier to find, use and revisit.", "A student-focused learning-resource platform designed to make digital study materials more discoverable and flexible to access.", [["Access with dignity","We want students, including people with visual impairments, to have more ways to engage with digital learning materials."],["Useful tools, clearly explained","Resource discovery, personal libraries, controlled sharing and browser-supported read-aloud tools sit in one place."],["Keep improving","Accessibility is ongoing work. We aim to make limitations visible and improve through testing and feedback."]]],
    "/how-it-works": ["How it works", "A simple path from finding a resource to learning with it.", "Explore openly shared materials, create an account to save and contribute resources, and use the reading view when it suits your study style.", [["Explore","Search public materials by title, description or topic."],["Organize","Create an account to upload resources, save items to My Library and see materials shared privately with you."],["Read documents","Open supported files directly in Voxora Access and use your browser or assistive technology to read them."]]],
    "/accessibility": ["Accessibility", "More ways to access learning materials.", "Voxora Access is designed with flexible reading and navigation in mind.", [["Keyboard access","Use semantic links, buttons, labels and keyboard navigation throughout the interface."],["Read aloud","The reading view uses browser speech synthesis where available, with adjustable playback speed."],["Known limitations","Screen-reader support depends on document accessibility, browser and assistive technology. Scanned PDFs may need OCR, and complex documents should be checked with a screen reader."]]],
    "/contact": ["Contact", "Contact Voxora Access", "Questions about using the platform, accessibility barriers, privacy concerns or resource rights reports should have a clear route to the platform operator.", [["Technical support","Include the page you were using, what happened and the browser/device involved."],["Accessibility feedback","Describe the task you were trying to complete and the barrier you encountered."],["Privacy and copyright","Review the privacy and copyright pages. Operator contact details must be completed before public launch."]]],
    "/preferences": ["Your experience", "Preferences and support", "Speech voices and recognition options depend on your browser and operating system.", [["Document access","Open supported documents in the embedded viewer or use the original-file link."],["Screen readers","Use your screen reader navigation commands inside the document viewer when supported."],["Browser settings","Screen-reader and document-viewer support varies by browser, operating system and document structure."]]],
};
const policyCopy = {
    "/privacy": ["Privacy notice","This notice explains how Voxora Access handles information when you browse the platform, create an account, upload resources or use sharing and reading features.","Account information includes name, email, password hash and account creation time. Resource information includes title, description, file metadata and uploaded document bytes. Library and sharing records associate resources with accounts.","The application uses information to authenticate accounts, store and display resources, search public materials, enforce access permissions and operate the service. Public resources are discoverable; private resources are intended for their owner and accounts explicitly shared with.","The current application stores account data, resource metadata and uploaded file bytes in PostgreSQL and is configured for hosted database and Render web hosting. Operator details and provider information should be completed before public launch. This draft is not legal compliance certification."],
    "/terms": ["Terms of use","By using Voxora Access, you agree to use the platform lawfully and respectfully.","You are responsible for the materials you upload and must have the rights or permission needed to store and share them. Choose public or private visibility carefully. Do not upload confidential information unless you have authority and understand the consequences.","The platform is provided on an as-available basis. Embedded previews display supported original files without flattening them into extracted text. Screen-reader access still depends on the document being properly structured and tagged; verify important information against the original material.","These terms may be updated as the service changes. Contact the platform operator for questions."],
    "/cookies": ["Cookie notice","The application uses an essential session cookie to maintain sign-in state and security-related session information.","The session cookie is configured as HTTP-only and SameSite=Lax; the Secure flag is enabled when the application is configured for HTTPS. Blocking essential session cookies may prevent sign-in and account features from working properly.","The reading view uses browser speech synthesis when available. This feature is not described as a cookie. The prototype does not currently provide an analytics or advertising-cookie consent interface."],
    "/acceptable-use": ["Acceptable use policy","Voxora Access is intended to support learning and resource sharing. Everyone using the platform must act lawfully, respectfully and in a way that protects other users.","Do not upload materials you lack permission to distribute, distribute malware, harass others, publish private information without authority, attempt unauthorized access, interfere with platform availability or bypass security controls.","Check content and permissions before uploading. Select public visibility only when you intend the material to be discoverable. Private sharing is limited to selected accounts, but the service is not a secure vault for highly sensitive information."],
    "/copyright": ["Copyright and content reports","Users must upload and share only materials they own or are authorized to use and distribute.","A report should identify the resource, describe the work or right involved, explain why the use is unauthorized and include reliable contact details and supporting information where applicable.","The operator may request more information, restrict access while reviewing a credible report, notify the uploader where appropriate, or restore material if a report is not substantiated. This is not a formal statutory notice-and-counter-notice procedure."]
};

function VoiceAssistant() {
    const [active, setActive] = useState(false);
    const [muted, setMuted] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("Starting voice access…");
    const recognitionRef = useRef(null);
    const activeRef = useRef(false);
    const mutedRef = useRef(false);
    const speakingRef = useRef(false);
    const busyRef = useRef(false);
    const messagesRef = useRef([]);
    const speakingTextRef = useRef("");

    useEffect(() => { activeRef.current = active; }, [active]);
    useEffect(() => { mutedRef.current = muted; }, [muted]);

    const startListening = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setNotice("This browser does not support voice recognition. Try Chrome or Edge, or use your device's screen reader.");
            return;
        }
        if (!recognitionRef.current) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = false;
            recognition.lang = "en-NG";
            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    if (event.results[i].isFinal) {
                        const transcript = event.results[i][0].transcript.trim();
                        if (!transcript || mutedRef.current) continue;
                        if (speakingRef.current) {
                            const heard = transcript.toLowerCase().replace(/[^a-z0-9\\s]/g, " ").split(/\\s+/).filter(Boolean);
                            const spoken = speakingTextRef.current.toLowerCase().replace(/[^a-z0-9\\s]/g, " ").split(/\\s+/).filter(Boolean);
                            const spokenSet = new Set(spoken);
                            const overlap = heard.length ? heard.filter(word => spokenSet.has(word)).length / heard.length : 1;
                            const likelyEcho = overlap >= 0.55 || (heard.length >= 3 && spoken.join(" ").includes(heard.join(" ")));
                            if (likelyEcho) continue;
                            window.speechSynthesis?.cancel();
                            speakingRef.current = false;
                            speakingTextRef.current = "";
                            setSpeaking(false);
                            handleVoiceInput(transcript);
                        } else if (!busyRef.current) {
                            handleVoiceInput(transcript);
                        }
                    }
                }
            };
            recognition.onerror = (event) => {
                if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                    activeRef.current = false;
                    setActive(false);
                    setNotice("Microphone permission is needed. Select Enable voice and allow microphone access in your browser.");
                } else if (event.error !== "no-speech" && event.error !== "aborted") {
                    setNotice("Voice recognition paused. Select Resume listening to try again.");
                }
            };
            recognition.onend = () => {
                if (activeRef.current && !mutedRef.current && !speakingRef.current && !busyRef.current) {
                    window.setTimeout(() => {
                        if (activeRef.current && !mutedRef.current && !speakingRef.current && !busyRef.current) {
                            try { recognition.start(); } catch (_) {}
                        }
                    }, 350);
                }
            };
            recognitionRef.current = recognition;
        }
        activeRef.current = true;
        mutedRef.current = false;
        setActive(true);
        setMuted(false);
        setNotice("Listening. Speak naturally to Voxora.");
        try { recognitionRef.current.start(); } catch (_) {
            setNotice("Your browser needs a tap to enable the microphone. Select Enable voice.");
        }
    };

    const resumeListening = () => {
        if (!activeRef.current || mutedRef.current || speakingRef.current || busyRef.current) return;
        try { recognitionRef.current?.start(); } catch (_) {}
    };

    const speak = (text) => {
        if (!("speechSynthesis" in window) || mutedRef.current) {
            resumeListening();
            return;
        }
        speakingRef.current = true;
        speakingTextRef.current = text;
        setSpeaking(true);
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        utterance.onend = () => {
            speakingRef.current = false;
            speakingTextRef.current = "";
            setSpeaking(false);
            resumeListening();
        };
        utterance.onerror = () => {
            speakingRef.current = false;
            speakingTextRef.current = "";
            setSpeaking(false);
            resumeListening();
        };
        window.speechSynthesis.speak(utterance);
    };

    const handleVoiceInput = async (rawText) => {
        const text = rawText.trim();
        if (!text || busyRef.current) return;
        if (/^(voxora[,. ]+)?(mute yourself|mute|stop listening)$/i.test(text)) {
            mute();
            return;
        }
        if (/^(voxora[,. ]+)?(stop speaking|be quiet)$/i.test(text)) {
            window.speechSynthesis?.cancel();
            speakingRef.current = false;
            speakingTextRef.current = "";
            setSpeaking(false);
            resumeListening();
            return;
        }
        if (/^(voxora[,. ]+)?(stop listening|end voice session)$/i.test(text)) {
            endSession();
            return;
        }
        const next = [...messagesRef.current, { role: "user", content: text }];
        messagesRef.current = next;
        setBusy(true);
        busyRef.current = true;
        setNotice("Voxora is thinking…");
        try {
            const response = await fetch("/api/assistant/chat", {
                method: "POST",
                headers: {"Content-Type": "application/json", "X-CSRF-Token": window.voxoraCsrf || "", Accept: "application/json"},
                credentials: "same-origin",
                body: JSON.stringify({ messages: next.slice(-12) })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Voxora couldn't respond.");
            const answer = result.reply || "I'm here. What would you like to explore?";
            messagesRef.current = [...next, { role: "assistant", content: answer }];
            setNotice("Voxora is speaking…");
            busyRef.current = false;
            setBusy(false);
            speak(answer);
        } catch (error) {
            setNotice(error.message + " You can try speaking again.");
            busyRef.current = false;
            setBusy(false);
            resumeListening();
        }
    };

    const mute = () => {
        mutedRef.current = true;
        setMuted(true);
        recognitionRef.current?.stop();
        window.speechSynthesis?.cancel();
        speakingRef.current = false;
        setSpeaking(false);
        setNotice("Microphone muted. Select Resume listening when you are ready.");
    };

    const endSession = () => {
        activeRef.current = false;
        mutedRef.current = false;
        setActive(false);
        setMuted(false);
        recognitionRef.current?.stop();
        window.speechSynthesis?.cancel();
        speakingRef.current = false;
        setSpeaking(false);
        setNotice("Voice access is paused. Select Enable voice to start again.");
    };

    useEffect(() => {
        // Attempt voice activation on page arrival. Browser permission and user-gesture
        // policies may require the user to press the accessible start control.
        const timer = window.setTimeout(() => startListening(), 500);
        return () => {
            window.clearTimeout(timer);
            activeRef.current = false;
            recognitionRef.current?.stop();
            window.speechSynthesis?.cancel();
        };
    }, []);

    return <>
    <button className="voxora-global-stop" type="button" aria-label="Stop Voxora speaking now" onClick={() => {
        window.speechSynthesis?.cancel();
        speakingRef.current = false;
        speakingTextRef.current = "";
        setSpeaking(false);
        setNotice("Speech stopped. You can speak whenever you're ready.");
        resumeListening();
    }}>■ Stop Voxora speaking</button>
    <section className="voxora-voice-access" aria-label="Voxora voice access">
        <div className="voxora-voice-orb" data-state={speaking ? "speaking" : busy ? "thinking" : active && !muted ? "listening" : "idle"} aria-hidden="true">
            <span/>
        </div>
        <h2>Talk to Voxora</h2>
        <p className="voxora-voice-status" role="status" aria-live="polite">{notice}</p>
        <div className="voxora-voice-controls">
            {!active || muted
                ? <button type="button" className="voxora-voice-primary" onClick={startListening}>Enable voice / Resume listening</button>
                : <button type="button" onClick={mute}>Mute microphone</button>}
            <button type="button" onClick={() => {
                window.speechSynthesis?.cancel();
                speakingRef.current = false;
                setSpeaking(false);
                setNotice("Speech stopped. Listening will resume.");
                resumeListening();
            }}>Stop speaking</button>
            {active && <button type="button" onClick={endSession}>Pause voice access</button>}
        </div>
        <p className="voxora-voice-help">Speak naturally. You can speak while Voxora is replying to interrupt it. Likely copies of Voxora's own words are filtered; results depend on your microphone, speakers and browser. You can mute or pause voice access at any time.</p>
        <span className="sr-only">{busy ? "Processing your request" : speaking ? "Voxora is speaking" : active && !muted ? "Microphone is listening" : "Microphone is not listening"}</span>
    </section>
    </>;
}
function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const path = location.pathname;
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [authMessage, setAuthMessage] = useState("");
    const [currentUser, setCurrentUser] = useState(window.voxoraUser);
    const user = currentUser;
    const isDashboardArea = Boolean(user) && (accountNav.some(([href]) => href === path) || path.startsWith("/resource/") || path === "/account");
    useEffect(() => {
        let active = true;
        setData(null);
        setError("");
        fetch("/api/site?path=" + encodeURIComponent(path) + (location.search || ""), { headers: { Accept: "application/json" } })
            .then((r) => { if (!r.ok) throw new Error("This page could not be loaded."); return r.json(); })
            .then((result) => { if (active) setData(result); })
            .catch((e) => { if (active) setError(e.message); });
        return () => { active = false; };
    }, [path, location.search]);
    const csrf = window.voxoraCsrf || "";
    const flash = window.voxoraFlashMessages || [];
    const handleSignout = async (event) => {
        event.preventDefault();
        try {
            const response = await fetch("/api/auth/signout", {
                method: "POST",
                headers: { "X-CSRF-Token": csrf, Accept: "application/json" },
                credentials: "same-origin",
            });
            if (!response.ok) throw new Error("Sign out could not be completed. Please try again.");
            setCurrentUser(null);
            window.voxoraUser = null;
            navigate("/");
        } catch (err) {
            setAuthMessage(err.message);
        }
    };
    const signout = <form method="post" action="/signout" onSubmit={handleSignout}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-signout">Sign out</button></form>;
    const Header = () => <header className={"react-topbar" + (isDashboardArea && user ? " react-workspace-topbar" : "")}><a className="react-brand" href={user && isDashboardArea ? "/dashboard" : "/"}><span className="react-brand-mark" aria-hidden="true">V</span><span className="react-brand-copy"><strong>Voxora Access</strong><small>{user && isDashboardArea ? "YOUR LEARNING WORKSPACE" : "Knowledge within everyone's reach."}</small></span></a>{user && isDashboardArea ? <div className="react-topbar-actions react-workspace-actions"><span className="react-user" aria-label="Signed in as">{user.name}</span><a className="react-account-link" href="/account">Account</a>{signout}</div> : <><nav className="react-topbar-actions" aria-label="Main navigation">{nav.map(([href,label])=><a key={href} href={href}>{label}</a>)}</nav><div className="react-topbar-actions">{user ? <><a href="/dashboard">My workspace</a><span className="react-user">{user.name}</span>{signout}</> : <><a href="/signin">Sign in</a><a className="react-primary-button" href="/register">Create account</a></>}</div></>}</header>;
    const Footer = () => <footer className={"react-site-footer" + (isDashboardArea && user ? " react-workspace-footer" : "")}><div><b>Voxora Access</b><p>{isDashboardArea && user ? "Your learning space, built for access." : "Listen. Learn. Explore. Achieve."}</p></div><nav aria-label="Footer navigation">{(isDashboardArea && user ? [] : [...nav,...legal]).map(([href,label])=><a key={href} href={href}>{label}</a>)}</nav><small>© {new Date().getFullYear()} Voxora Access. All rights reserved.</small></footer>;
    const Sidebar = () => user && isDashboardArea ? <aside className="react-sidebar" aria-label="Workspace navigation"><div className="react-sidebar-label">WORKSPACE</div><nav>{accountNav.map(([href,label])=><a key={href} className={path===href?"active":""} aria-current={path===href?"page":undefined} href={href}>{label}</a>)}</nav><div className="react-sidebar-divider"/><div className="react-sidebar-label">ACCOUNT</div><nav><a className={path==="/account"?"active":""} aria-current={path==="/account"?"page":undefined} href="/account">Account settings</a><a href="/signout" onClick={(event)=>{event.preventDefault();document.getElementById("voxora-signout-form")?.requestSubmit();}}>Sign out</a></nav></aside> : null;
    const Frame = ({children}) => <div className="react-site-frame" onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = event.target.closest("a[href]");
        if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin || url.pathname.startsWith("/resource/") && /\/(preview|download)$/.test(url.pathname)) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
        if (url.pathname.startsWith("/signout")) return;
        event.preventDefault();
        navigate(url.pathname + url.search + url.hash);
    }}><a className="react-skip-link" href="#main-content">Skip to main content</a><Header/><div className={isDashboardArea && user ? "react-app-layout" : "react-public-layout"}><Sidebar/><main id="main-content" tabIndex="-1" className="react-page-main">{flash.map((m,i)=><p key={i} className={"flash "+m.category} role="status">{m.message}</p>)}{children}</main></div><Footer/><button className="react-scroll-top" type="button" aria-label="Scroll to top" title="Scroll to top" onClick={()=>window.scrollTo({top:0,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})}>↑<span>Top</span></button><form id="voxora-signout-form" method="post" action="/signout" onSubmit={handleSignout} hidden><input type="hidden" name="_csrf_token" value={csrf}/></form></div>;
    const Cards = ({items}) => <div className="react-feature-grid">{items.map(([title,body])=><article className="react-feature-card" key={title}><h2>{title}</h2><p>{body}</p></article>)}</div>;
    const Resources = ({items,empty}) => items?.length ? <div className="react-card-grid">{items.map(r=><article className="react-content-card" key={r.id}><span className="react-filetype">{(r.extension||"FILE").toUpperCase()}</span><h2><a href={"/resource/"+r.id}>{r.title}</a></h2><p>{r.description || "A shared learning resource."}</p><small>{r.owner_name ? "Shared by "+r.owner_name : (r.visibility||"")} </small><a href={"/resource/"+r.id}>Open resource →</a></article>)}</div> : <div className="react-empty">{empty}</div>;
    const FormField = ({label,...props}) => <label className="react-field">{label}<input {...props}/></label>;
    const Dashboard = () => {
        const [dash,setDash]=useState(null);
        useEffect(()=>{fetch("/api/dashboard").then(r=>{if(!r.ok)throw new Error("Dashboard data unavailable");return r.json()}).then(setDash).catch(e=>setError(e.message))},[]);
        if(!dash)return <section className="react-loading-panel" role="status" aria-live="polite"><div className="react-loader-orbit" aria-hidden="true"><span/></div><h2>Preparing your workspace</h2><p>Gathering your resources and recent activity…</p><div className="react-skeleton-grid" aria-hidden="true"><i/><i/><i/><i/></div><div className="react-skeleton-line" aria-hidden="true"/><div className="react-skeleton-line short" aria-hidden="true"/></section>;
        return <><p className="react-eyebrow">YOUR LEARNING SPACE</p><h1>Welcome back, {dash.user.name.split(" ")[0]}.</h1><p>Pick up where you left off or add something new to your library.</p><a className="react-primary-button" href="/upload">＋ Upload a resource</a><section className="react-stats">{[["Your uploads",dash.stats.uploads],["Public resources",dash.stats.public],["Saved in library",dash.stats.saved],["Shared with you",dash.stats.shared]].map(([k,v])=><article className="react-stat" key={k}><span>{k}</span><strong>{v}</strong></article>)}</section><h2>Recent uploads</h2><Resources items={dash.recent} empty="You haven't uploaded a resource yet."/><h2>Saved for later</h2><Resources items={dash.saved} empty="Your library is waiting for its first resource."/></>;
    };
    if(error)return <Frame><div className="react-error" role="alert">{error} <a href="/">Return home</a></div></Frame>;
    if(!data)return <div className="react-initial-loading" role="status" aria-live="polite"><div className="react-loader-orbit" aria-hidden="true"><span/></div><strong>Voxora Access</strong><p>Getting everything ready for you…</p><div className="react-loading-track"><span/></div></div>;
    let content;
    if(path==="/") content=<><section className="react-hero"><div><p className="react-eyebrow">KNOWLEDGE WITHIN EVERYONE'S REACH</p><h1>Learning, on your terms.</h1><p>Discover learning resources, organize your materials and listen when reading on screen isn't the easiest option.</p><div className="react-actions"><a className="react-primary-button" href="/register">Create your free account</a><a href="#resources">Explore resources ↓</a></div></div><div className="react-hero-art" aria-hidden="true">V<span>LISTEN · LEARN · EXPLORE</span></div></section><Cards items={[["Discover resources","Browse publicly shared study materials."],["Make it personal","Save useful materials in your own library."],["Choose how to read","Use the reading view and supported browser speech."]]}/><section id="resources"><div className="react-section-heading"><div><p className="react-eyebrow">OPEN KNOWLEDGE</p><h2>Explore public resources</h2></div><form className="react-search"><input name="q" defaultValue={data.query||""} placeholder="Search by title or topic" aria-label="Search resources"/><button className="react-primary-button">Search</button></form></div><Resources items={data.resources} empty="Public resources will appear here as the community shares learning materials."/></section></>;
    else if(path==="/signin"||path==="/register") {const reg=path==="/register";content=<section className="react-auth"><div><p className="react-eyebrow">WELCOME TO VOXORA ACCESS</p><h1>Learning, on your terms.</h1><p>Keep resources close, discover shared materials, and listen when reading on screen isn't the easiest option.</p></div><form method="post" className="react-form" onSubmit={async(event)=>{event.preventDefault();setAuthMessage("");const form=event.currentTarget;try{const response=await fetch("/api/auth/"+(reg?"register":"signin")+window.location.search,{method:"POST",body:new FormData(form),headers:{"X-CSRF-Token":csrf,Accept:"application/json"},credentials:"same-origin"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Authentication could not be completed.");setCurrentUser(result.user);window.voxoraUser=result.user;if(result.csrf)window.voxoraCsrf=result.csrf;setAuthMessage("");navigate(result.redirect||"/dashboard");}catch(err){setAuthMessage(err.message);}}}><h2>{reg?"Create your account":"Sign in to Voxora Access"}</h2><input type="hidden" name="_csrf_token" value={csrf}/>{reg&&<FormField label="Full name" name="name" autoComplete="name" required maxLength="80"/>}<FormField label="Email" name="email" type="email" autoComplete="email" required/><FormField label="Password" name="password" type="password" autoComplete={reg?"new-password":"current-password"} required minLength={reg?10:undefined}/>{reg&&<small>Use at least 10 characters.</small>}{authMessage&&<p className="react-auth-message" role="alert">{authMessage}</p>}<button className="react-primary-button">{reg?"Create account":"Sign in"}</button><p>{reg?"Already registered? ":"New to Voxora Access? "}<a href={reg?"/signin":"/register"}>{reg?"Sign in":"Create an account"}</a></p></form></section>}
    else if(path==="/dashboard")content=<Dashboard/>;
    else if(path==="/account")content=<><p className="react-eyebrow">ACCOUNT MANAGEMENT</p><h1>Your account</h1><p>Review the details associated with your Voxora Access account.</p><section className="react-account-panel"><div className="react-account-avatar" aria-hidden="true">{(user?.name||"U").trim().charAt(0).toUpperCase()}</div><div><span className="react-account-label">ACCOUNT HOLDER</span><h2>{user?.name||"User"}</h2><p>{user?.email||""}</p></div></section><div className="react-account-settings"><article><div><h2>Personal information</h2><p>Your profile name and email address are used to identify your account.</p></div><dl><div><dt>Full name</dt><dd>{user?.name||"Not available"}</dd></div><div><dt>Email address</dt><dd>{user?.email||"Not available"}</dd></div></dl></article><article><div><h2>Workspace preferences</h2><p>Manage how you access and read learning resources.</p></div><a className="react-secondary-button" href="/preferences">Open preferences</a></article><article><div><h2>Security</h2><p>Always sign out when using a shared or public device. Password management is handled through the sign-in process.</p></div><form method="post" action="/signout"><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-danger-button">Sign out of this account</button></form></article></div></>;
    else if(path==="/upload")content=<><p className="react-eyebrow">SHARE KNOWLEDGE</p><h1>Upload a resource</h1><p>Add study materials for your own use or share them publicly.</p><form className="react-form" method="post" encType="multipart/form-data"><input type="hidden" name="_csrf_token" value={csrf}/><FormField as="input" label="Choose a file" name="file" type="file" required accept=".pdf,.docx,.pptx,.txt,.md,.rtf,.csv,.odt,.ods,.odp"/><small>PDF, DOCX, PPTX, TXT, MD, RTF, CSV, ODT, ODS or ODP. Maximum 20 MB by default.</small><FormField label="Resource title" name="title" maxLength="160" placeholder="e.g. Introduction to Biology"/><label className="react-field">Short description<textarea name="description" rows="4" maxLength="1000"/></label><fieldset><legend>Who can access it?</legend><label><input type="radio" name="visibility" value="public" defaultChecked/> Public</label><label><input type="radio" name="visibility" value="private"/> Private</label></fieldset><button className="react-primary-button">Upload resource</button></form></>;
    else if(path==="/my-resources"||path==="/library"||path==="/shared-with-me")content=<><p className="react-eyebrow">YOUR WORKSPACE</p><h1>{path==="/my-resources"?"My uploads":path==="/library"?"My Library":"Shared with me"}</h1><p>{path==="/my-resources"?"Manage resources you've uploaded.":path==="/library"?"Saved resources, ready when you are.":"Private resources shared with your account."}</p><Resources items={data.resources} empty="Nothing to show here yet."/></>;
    else if(path.startsWith("/resource/")&&data.resource){const r=data.resource;const ext=(r.extension||"").toLowerCase();const previewable=["pdf","docx","pptx","txt","md","csv"].includes(ext);const isPdf=ext==="pdf"||ext==="docx"||ext==="pptx";content=<><p><a href="/">Explore</a> / {r.title}</p><p className="react-eyebrow">{r.extension.toUpperCase()} DOCUMENT</p><h1>{r.title}</h1><p>{r.description||"No description provided."}</p><p>Owner: {r.owner_name} · {Math.round(r.size_bytes/1024)} KB · {r.visibility}</p><div className="react-actions"><a className="react-primary-button" href={"/resource/"+r.id+"/read"}>Open document viewer</a><a href={"/resource/"+r.id+"/download"}>Download original</a></div><section className="react-document-panel" aria-labelledby="document-preview-title"><div className="react-document-heading"><div><h2 id="document-preview-title">Document preview</h2><p>DOCX and PPTX files are converted to PDF for in-page viewing. The original file remains available to download.</p></div><a href={"/resource/"+r.id+"/download"}>Open or download original</a></div>{previewable?<iframe className="react-document-frame" title={(isPdf?"PDF preview of "+r.extension.toUpperCase()+": ":"Text document: ")+r.title} src={"/resource/"+r.id+"/preview"} />:<div className="react-document-fallback"><h3>PDF preview is not available</h3><p>The original file is stored safely. The PDF preview may be unavailable if conversion failed or LibreOffice is not installed. You can still download the original document.</p><a className="react-primary-button" href={"/resource/"+r.id+"/download"}>Download {r.extension.toUpperCase()}</a></div>}</section><p className="react-accessibility-note">Accessibility note: an embedded viewer does not automatically make a document accessible. Screen-reader results depend on the document's structure and tags, and scanned PDFs may require OCR.</p>{user&&<form method="post" action={"/resource/"+r.id+"/library"}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-primary-button">{r.in_library?"Remove from My Library":"Add to My Library"}</button></form>}{r.is_owner&&<><h2>Share this resource</h2><form method="post" action={"/resource/"+r.id+"/share"} className="react-form"><input type="hidden" name="_csrf_token" value={csrf}/><FormField label="Account email" name="email" type="email" required placeholder="student@example.edu"/><button className="react-primary-button">Share</button></form><form method="post" action={"/resource/"+r.id+"/delete"} onSubmit={e=>{if(!confirm("Delete this resource permanently?"))e.preventDefault()}}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-danger-button">Delete resource</button></form></>}</>}
    else if(pageCopy[path]){const [eyebrow,title,lede,items]=pageCopy[path];content=<><p className="react-eyebrow">{eyebrow.toUpperCase()}</p><h1>{title}</h1><p className="react-lede">{lede}</p><Cards items={items}/><a className="react-primary-button" href="/register">Get started</a></>}
    else if(policyCopy[path]){const [title,...paragraphs]=policyCopy[path];content=<article className="react-policy"><p className="react-eyebrow">PLATFORM POLICIES</p><h1>{title}</h1><p className="react-muted">Last updated: 31 October 2026</p>{paragraphs.map((p,i)=><p key={i}>{p}</p>)}</article>}
    else content=<><h1>Page not found</h1><p>The page you're looking for isn't available.</p><a href="/">Return home</a></>;
    return <Frame>{content}</Frame>;
}
createRoot(document.getElementById("voxora-app-root")).render(<BrowserRouter><><App/><VoiceAssistant/></></BrowserRouter>);
