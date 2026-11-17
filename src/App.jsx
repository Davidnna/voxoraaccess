import React, { useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { accountNav, legal, nav } from "./data/navigation.js";
import { pageCopy, policyCopy } from "./data/pageContent.js";

function AppLink({ href, ...props }) {
    const isExternal = !href || href.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(href) ||
        Boolean(props.target || props.download) || /^\/resource\/\d+\/(preview|download)$/.test(href);
    if (isExternal) {
        return <a href={href} {...props}/>;
    }
    return <Link to={href} {...props}/>;
}

function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const path = location.pathname;
    const [data, setData] = useState(null);
    const [pageLoading, setPageLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);
    const pageCacheRef = useRef(new Map());
    const [error, setError] = useState("");
    const [authMessage, setAuthMessage] = useState("");
    const [localFlash, setLocalFlash] = useState([]);
    const [currentUser, setCurrentUser] = useState(window.voxoraUser);
    const user = currentUser;
    const isDashboardArea = Boolean(user) && (accountNav.some(([href]) => href === path) || path.startsWith("/resource/") || path === "/account");
    useEffect(() => {
        let active = true;
        const cacheKey = path + (location.search || "");
        const cached = pageCacheRef.current.get(cacheKey);
        setError("");
        if (cached) {
            setData(cached);
            setPageLoading(false);
            window.voxoraCurrentResourceText = cached.resource?.text_excerpt || "";
            window.voxoraCurrentResourceTruncated = Boolean(cached.resource?.text_truncated);
        } else {
            setPageLoading(true);
        }
        const controller = new AbortController();
        fetch("/api/site?path=" + encodeURIComponent(path) + (location.search || ""), {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            signal: controller.signal
        })
            .then((response) => {
                if (response.status === 401) {
                    const requestedPath = path + (location.search || "");
                    setCurrentUser(null);
                    window.voxoraUser = null;
                    window.dispatchEvent(new Event("voxora:session-ended"));
                    navigate("/signin?next=" + encodeURIComponent(requestedPath), { replace: true });
                    return null;
                }
                if (!response.ok) throw new Error("This page could not be loaded.");
                return response.json();
            })
            .then((result) => {
                if (active && result) {
                    pageCacheRef.current.set(cacheKey, result);
                    setData(result);
                    setPageLoading(false);
                    window.voxoraCurrentResourceText = result.resource?.text_excerpt || "";
                    window.voxoraCurrentResourceTruncated = Boolean(result.resource?.text_truncated);
                }
            })
            .catch((fetchError) => {
                if (active && fetchError.name !== "AbortError") {
                    setError(fetchError.message);
                    setPageLoading(false);
                }
            });
        return () => { active = false; controller.abort(); };
    }, [path, location.search, refreshKey]);
    useEffect(() => {
        const refreshAfterAssistantAction = () => {
            pageCacheRef.current.clear();
            setRefreshKey((current) => current + 1);
        };
        window.addEventListener("voxora:data-changed", refreshAfterAssistantAction);
        return () => window.removeEventListener("voxora:data-changed", refreshAfterAssistantAction);
    }, []);
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
    }, [location.key]);
    useEffect(() => {
        if (!data || data.path !== path) return undefined;
        const heading = document.querySelector("#main-content h1");
        if (heading?.textContent?.trim()) document.title = heading.textContent.trim() + " | Voxora Access";
        const timer = window.setTimeout(() => document.getElementById("main-content")?.focus(), 30);
        return () => window.clearTimeout(timer);
    }, [data, path]);
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
            pageCacheRef.current.clear();
            setCurrentUser(null);
            window.voxoraUser = null;
            window.dispatchEvent(new Event("voxora:session-ended"));
            navigate("/");
        } catch (err) {
            setAuthMessage(err.message);
            setLocalFlash([{ category: "error", message: err.message }]);
        }
    };
    const signout = <form method="post" action="/signout" onSubmit={handleSignout}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-signout">Sign out</button></form>;
    const Header = () => <header className={"react-topbar" + (isDashboardArea && user ? " react-workspace-topbar" : "")}><AppLink className="react-brand" href={user && isDashboardArea ? "/dashboard" : "/"}><span className="react-brand-mark" aria-hidden="true">V</span><span className="react-brand-copy"><strong>Voxora Access</strong><small>{user && isDashboardArea ? "YOUR LEARNING WORKSPACE" : "Knowledge within everyone's reach."}</small></span></AppLink>{user && isDashboardArea ? <div className="react-topbar-actions react-workspace-actions"><span className="react-user">{user.name}</span><AppLink className="react-account-link" href="/account">Account</AppLink>{signout}</div> : <><nav className="react-topbar-actions" aria-label="Main navigation">{nav.map(([href,label])=><AppLink key={href} href={href} aria-current={path===href?"page":undefined}>{label}</AppLink>)}</nav><div className="react-topbar-actions">{user ? <><AppLink href="/dashboard">My workspace</AppLink><span className="react-user">{user.name}</span>{signout}</> : <><AppLink href="/signin">Sign in</AppLink><AppLink className="react-primary-button" href="/register">Create account</AppLink></>}</div></>}</header>;
    const Footer = () => <footer className={"react-site-footer" + (isDashboardArea && user ? " react-workspace-footer" : "")}><div><b>Voxora Access</b><p>{isDashboardArea && user ? "Your learning space, built for access." : "Listen. Learn. Explore. Achieve."}</p></div><nav aria-label="Footer navigation">{(isDashboardArea && user ? [] : [...nav,...legal]).map(([href,label])=><AppLink key={href} href={href}>{label}</AppLink>)}</nav><small>© {new Date().getFullYear()} Voxora Access. All rights reserved.</small></footer>;
    const Sidebar = () => user && isDashboardArea ? <aside className="react-sidebar" aria-label="Workspace navigation"><div className="react-sidebar-label">WORKSPACE</div><nav>{accountNav.map(([href,label])=><AppLink key={href} className={path===href?"active":""} aria-current={path===href?"page":undefined} href={href}>{label}</AppLink>)}</nav><div className="react-sidebar-divider"/><div className="react-sidebar-label">ACCOUNT</div><nav><AppLink className={path==="/account"?"active":""} aria-current={path==="/account"?"page":undefined} href="/account">Account settings</AppLink><AppLink href="/signout" onClick={(event)=>{event.preventDefault();document.getElementById("voxora-signout-form")?.requestSubmit();}}>Sign out</AppLink></nav></aside> : null;
    const Frame = ({children}) => <div className="react-site-frame" onSubmit={async(event)=>{const form=event.target;if(event.defaultPrevented)return;const method=(form.method||"GET").toUpperCase();if(method!=="POST")return;const action=new URL(form.action||window.location.href,window.location.origin);if(action.origin!==window.location.origin)return;const isUpload=action.pathname==="/upload";const match=action.pathname.match(/^\/resource\/(\d+)\/(library|share|delete)$/);if(!isUpload&&!match)return;event.preventDefault();try{const response=await fetch(action.pathname+action.search,{method:"POST",body:new FormData(form),credentials:"same-origin",headers:{"X-CSRF-Token":csrf,"X-Requested-With":"XMLHttpRequest",Accept:"application/json, text/html"}});if(!response.ok){let details={};try{details=await response.json();}catch(_){}throw new Error(details.error||(response.status===400?"Your security token expired. Refresh the page and try again.":"The action could not be completed. Please check your details and try again."));}if(!response.redirected)throw new Error("The server did not confirm the action.");const target=new URL(response.url);if(isUpload&&target.pathname==="/upload")throw new Error("The upload was not accepted. Check that the file type is supported, the file is not empty, and it is within the upload size limit.");pageCacheRef.current.clear();setLocalFlash([{category:"success",message:isUpload?"Your resource was uploaded.":match[2]==="share"?"Resource sharing completed.":match[2]==="delete"?"Resource deleted.":"Your library was updated."}]);navigate(target.pathname+target.search);}catch(err){setLocalFlash([{category:"error",message:err.message}]);}}}><AppLink className="react-skip-link" href="#main-content">Skip to main content</AppLink><Header/><div className={isDashboardArea && user ? "react-app-layout" : "react-public-layout"}><Sidebar/><main id="main-content" tabIndex="-1" className="react-page-main" aria-busy={pageLoading && (!data || data.path !== path)}>{[...flash, ...localFlash].map((m,i)=><p key={i} className={"flash "+m.category} role={m.category==="error"?"alert":"status"} aria-live={m.category==="error"?"assertive":"polite"}>{m.message}</p>)}{children}</main></div><Footer/><button className="react-scroll-top" type="button" aria-label="Scroll to top" title="Scroll to top" onClick={()=>window.scrollTo({top:0,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})}>↑<span>Top</span></button><form id="voxora-signout-form" method="post" action="/signout" onSubmit={handleSignout} hidden><input type="hidden" name="_csrf_token" value={csrf}/></form></div>;
    const Cards = ({items}) => <div className="react-feature-grid">{items.map(([title,body])=><article className="react-feature-card" key={title}><h2>{title}</h2><p>{body}</p></article>)}</div>;
    const Resources = ({items,empty}) => items?.length ? <div className="react-card-grid">{items.map(r=><article className="react-content-card" key={r.id}><span className="react-filetype">{(r.extension||"FILE").toUpperCase()}</span><h2><AppLink href={"/resource/"+r.id}>{r.title}</AppLink></h2><p>{r.description || "A shared learning resource."}</p><small>{r.owner_name ? "Shared by "+r.owner_name : (r.visibility||"")} </small><AppLink href={"/resource/"+r.id}>Open resource →</AppLink></article>)}</div> : <div className="react-empty">{empty}</div>;
    const FormField = ({label,...props}) => <label className="react-field">{label}<input {...props}/></label>;
    const Dashboard = ({ dash }) => {
        if (!dash) return <section className="react-loading-panel" role="status" aria-live="polite"><div className="react-loader-orbit" aria-hidden="true"><span/></div><h2>Preparing your workspace</h2><p>Gathering your resources and recent activity…</p><div className="react-skeleton-grid" aria-hidden="true"><i/><i/><i/><i/></div><div className="react-skeleton-line" aria-hidden="true"/><div className="react-skeleton-line short" aria-hidden="true"/></section>;
        return <><p className="react-eyebrow">YOUR LEARNING SPACE</p><h1>Welcome back, {dash.user.name.split(" ")[0]}.</h1><p>Pick up where you left off or add something new to your library.</p><AppLink className="react-primary-button" href="/upload">＋ Upload a resource</AppLink><section className="react-stats">{[["Your uploads",dash.stats.uploads],["Visible to members",dash.stats.public],["Saved in library",dash.stats.saved],["Shared with you",dash.stats.shared]].map(([k,v])=><article className="react-stat" key={k}><span>{k}</span><strong>{v}</strong></article>)}</section><h2>Recent uploads</h2><Resources items={dash.recent} empty="You haven't uploaded a resource yet."/><h2>Saved for later</h2><Resources items={dash.saved} empty="Your library is waiting for its first resource."/></>;
    };
    if(error)return <Frame><div className="react-error" role="alert"><p>{error}</p><div className="react-actions"><button type="button" className="react-secondary-button" onClick={() => { setError(""); setRefreshKey((current) => current + 1); }}>Try again</button><AppLink href="/">Return home</AppLink></div></div></Frame>;
    if (pageLoading && (!data || data.path !== path)) {
        return <Frame><section className="react-route-loading" role="status" aria-live="polite"><span className="react-route-loading-dot"/><span>Loading this section…</span></section></Frame>;
    }
    if (!data || data.path !== path) {
        return <Frame><div className="react-error" role="alert">This section could not be loaded. <button type="button" className="react-secondary-button" onClick={() => navigate(0)}>Try again</button></div></Frame>;
    }
    let content;
    if(path==="/") content=<><section className="react-hero"><div><p className="react-eyebrow">KNOWLEDGE WITHIN EVERYONE'S REACH</p><h1>Learning, on your terms.</h1><p>Discover learning resources, organize your materials and listen when reading on screen isn't the easiest option. Sign in to access your learning resources and personal workspace.</p><div className="react-actions">{user ? <AppLink className="react-primary-button" href="/dashboard">Open your workspace</AppLink> : <><AppLink className="react-primary-button" href="/register">Create your free account</AppLink><AppLink href="/signin">Sign in to access resources</AppLink></>}</div></div><div className="react-hero-art" aria-hidden="true">V<span>LISTEN · LEARN · EXPLORE</span></div></section><Cards items={[["Discover learning resources","Find study materials available to signed-in Voxora members."],["Make it personal","Save useful materials in your own library and manage your uploads."],["Choose how to read","Use document previews, accessible reading tools and voice interaction."]]}/></>;
    else if(path==="/signin"||path==="/register") {const reg=path==="/register";content=<section className="react-auth"><div><p className="react-eyebrow">WELCOME TO VOXORA ACCESS</p><h1>Learning, on your terms.</h1><p>Keep resources close, discover shared materials, and listen when reading on screen isn't the easiest option.</p></div><form method="post" className="react-form" onSubmit={async(event)=>{event.preventDefault();setAuthMessage("");const form=event.currentTarget;try{const response=await fetch("/api/auth/"+(reg?"register":"signin")+window.location.search,{method:"POST",body:new FormData(form),headers:{"X-CSRF-Token":csrf,Accept:"application/json"},credentials:"same-origin"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Authentication could not be completed.");pageCacheRef.current.clear();setCurrentUser(result.user);window.voxoraUser=result.user;if(result.csrf)window.voxoraCsrf=result.csrf;setAuthMessage("");navigate(result.redirect||"/dashboard");}catch(err){setAuthMessage(err.message);}}}><h2>{reg?"Create your account":"Sign in to Voxora Access"}</h2><input type="hidden" name="_csrf_token" value={csrf}/>{reg&&<FormField label="Full name" name="name" autoComplete="name" required maxLength="80"/>}<FormField label="Email" name="email" type="email" autoComplete="email" required/><FormField label="Password" name="password" type="password" autoComplete={reg?"new-password":"current-password"} required minLength={reg?10:undefined}/>{reg&&<small>Use at least 10 characters.</small>}{authMessage&&<p className="react-auth-message" role="alert">{authMessage}</p>}<button className="react-primary-button">{reg?"Create account":"Sign in"}</button><p>{reg?"Already registered? ":"New to Voxora Access? "}<AppLink href={reg?"/signin":"/register"}>{reg?"Sign in":"Create an account"}</AppLink></p></form></section>}
    else if(path==="/dashboard")content=<Dashboard dash={data.dashboard}/>;
    else if(path==="/account")content=<><p className="react-eyebrow">ACCOUNT MANAGEMENT</p><h1>Your account</h1><p>Review the details associated with your Voxora Access account.</p><section className="react-account-panel"><div className="react-account-avatar" aria-hidden="true">{(user?.name||"U").trim().charAt(0).toUpperCase()}</div><div><span className="react-account-label">ACCOUNT HOLDER</span><h2>{user?.name||"User"}</h2><p>{user?.email||""}</p></div></section><div className="react-account-settings"><article><div><h2>Personal information</h2><p>Your profile name and email address are used to identify your account.</p></div><dl><div><dt>Full name</dt><dd>{user?.name||"Not available"}</dd></div><div><dt>Email address</dt><dd>{user?.email||"Not available"}</dd></div></dl></article><article><div><h2>Workspace preferences</h2><p>Manage how you access and read learning resources.</p></div><AppLink className="react-secondary-button" href="/preferences">Open preferences</AppLink></article><article><div><h2>Security</h2><p>Always sign out when using a shared or public device. Password management is handled through the sign-in process.</p></div><form method="post" action="/signout" onSubmit={handleSignout}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-danger-button">Sign out of this account</button></form></article></div></>;
    else if(path==="/upload")content=<><p className="react-eyebrow">SHARE KNOWLEDGE</p><h1>Upload a resource</h1><p>Upload study materials for your own use or share them with signed-in Voxora members. Uploaded resources are never available to signed-out visitors.</p><form className="react-form" method="post" encType="multipart/form-data"><input type="hidden" name="_csrf_token" value={csrf}/><FormField as="input" label="Choose a file" name="file" type="file" required accept=".pdf,.docx,.pptx,.txt,.md,.rtf,.csv,.odt,.ods,.odp"/><small>PDF, DOCX, PPTX, TXT, MD, RTF, CSV, ODT, ODS or ODP. Maximum 20 MB by default.</small><FormField label="Resource title" name="title" maxLength="160" placeholder="e.g. Introduction to Biology"/><label className="react-field">Short description<textarea name="description" rows="4" maxLength="1000"/></label><small>Public means visible to signed-in Voxora members. Private means only you and accounts you explicitly share with.</small><fieldset><legend>Who can access it?</legend><label><input type="radio" name="visibility" value="public" defaultChecked/> All signed-in members</label><label><input type="radio" name="visibility" value="private"/> Private</label></fieldset><button className="react-primary-button">Upload resource</button></form></>;
    else if(path==="/my-resources"||path==="/library"||path==="/shared-with-me")content=<><p className="react-eyebrow">YOUR WORKSPACE</p><h1>{path==="/my-resources"?"My uploads":path==="/library"?"My Library":"Shared with me"}</h1><p>{path==="/my-resources"?"Manage resources you've uploaded.":path==="/library"?"Saved resources, ready when you are.":"Private resources shared with your account."}</p><Resources items={data.resources} empty="Nothing to show here yet."/></>;
    else if(path.startsWith("/resource/")&&data.resource){const r=data.resource;const ext=(r.extension||"").toLowerCase();const previewable=["pdf","docx","pptx","txt","md","csv"].includes(ext);const isPdf=ext==="pdf"||ext==="docx"||ext==="pptx";content=<><p><AppLink href="/">Explore</AppLink> / {r.title}</p><p className="react-eyebrow">{r.extension.toUpperCase()} DOCUMENT</p><h1>{r.title}</h1><p>{r.description||"No description provided."}</p><p>Owner: {r.owner_name} · {Math.round(r.size_bytes/1024)} KB · {r.visibility==="public"?"Visible to signed-in members":"Private"}</p><div className="react-actions"><AppLink className="react-primary-button" href={"/resource/"+r.id+"/read"}>Open document viewer</AppLink><AppLink href={"/resource/"+r.id+"/download"}>Download original</AppLink></div><section className="react-document-panel" aria-labelledby="document-preview-title"><div className="react-document-heading"><div><h2 id="document-preview-title">Document preview</h2><p>DOCX and PPTX files are converted to PDF for in-page viewing. The original file remains available to download.</p></div><div className="react-actions"><AppLink href={"/resource/"+r.id+"/preview"} target="_blank" rel="noopener noreferrer" className="react-secondary-button">Open preview in a new tab</AppLink><AppLink href={"/resource/"+r.id+"/download"}>Download original</AppLink></div></div>{previewable?<iframe className="react-document-frame" title={(isPdf?"PDF preview of "+r.extension.toUpperCase()+": ":"Text document: ")+r.title} aria-describedby="document-preview-help" src={"/resource/"+r.id+"/preview"} />:<div className="react-document-fallback"><h3>PDF preview is not available</h3><p>The original file is stored safely. The PDF preview may be unavailable if conversion failed or LibreOffice is not installed. You can still download the original document.</p><AppLink className="react-primary-button" href={"/resource/"+r.id+"/download"}>Download {r.extension.toUpperCase()}</AppLink></div>}</section><p id="document-preview-help" className="react-accessibility-note">The embedded preview uses your browser's document viewer. If it is difficult to navigate with your screen reader, open the preview in a new tab or download the original. Screen-reader access still depends on the document's structure and tags; scanned pages may require OCR.</p>{user&&<form method="post" action={"/resource/"+r.id+"/library"}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-primary-button">{r.in_library?"Remove from My Library":"Add to My Library"}</button></form>}{r.is_owner&&<><h2>Share this resource</h2><form method="post" action={"/resource/"+r.id+"/share"} className="react-form"><input type="hidden" name="_csrf_token" value={csrf}/><FormField label="Account email" name="email" type="email" required placeholder="student@example.edu"/><button className="react-primary-button">Share</button></form><form method="post" action={"/resource/"+r.id+"/delete"} onSubmit={e=>{if(!confirm("Delete this resource permanently?"))e.preventDefault()}}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-danger-button">Delete resource</button></form></>}</>}
    else if(pageCopy[path]){const [eyebrow,title,lede,items]=pageCopy[path];content=<><p className="react-eyebrow">{eyebrow.toUpperCase()}</p><h1>{title}</h1><p className="react-lede">{lede}</p><Cards items={items}/><AppLink className="react-primary-button" href="/register">Get started</AppLink></>}
    else if(policyCopy[path]){const [title,...paragraphs]=policyCopy[path];content=<article className="react-policy"><p className="react-eyebrow">PLATFORM POLICIES</p><h1>{title}</h1><p className="react-muted">Last updated: 31 October 2026</p>{paragraphs.map((p,i)=><p key={i}>{p}</p>)}</article>}
    else content=<><h1>Page not found</h1><p>The page you're looking for isn't available.</p><AppLink href="/">Return home</AppLink></>;
    return <Frame>{content}</Frame>;
}

const appRoutePaths = [
    "/", "/about", "/how-it-works", "/accessibility", "/contact",
    "/privacy", "/terms", "/cookies", "/acceptable-use", "/copyright",
    "/signin", "/register", "/dashboard", "/upload", "/my-resources",
    "/library", "/shared-with-me", "/preferences", "/account",
    "/resource/:resourceId", "/resource/:resourceId/read",
];

const sharedAppElement = <App/>;

export default function AppRoutes() {
    return (
        <Routes>
            {appRoutePaths.map((routePath) => (
                <Route key={routePath} path={routePath} element={sharedAppElement}/>
            ))}
            <Route path="*" element={sharedAppElement}/>
        </Routes>
    );
}
