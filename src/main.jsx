import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, useLocation, useNavigate } from "react-router-dom";
import "./dashboard.css";


function AppLink({ href, ...props }) {
    const isExternal = !href || href.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(href) ||
        Boolean(props.target || props.download) || /^\/resource\/\d+\/(preview|download)$/.test(href);
    if (isExternal) {
        return <a href={href} {...props}/>;
    }
    return <Link to={href} {...props}/>;
}

function normalizeVoiceText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

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
    "/privacy": ["Privacy notice","This notice explains how Voxora Access handles information when you browse the platform, create an account, upload resources or use sharing and reading features.","Account information includes name, email, password hash and account creation time. Resource information includes title, description, file metadata and uploaded document bytes. Library and sharing records associate resources with accounts.","The application uses information to authenticate accounts, store and display resources, search public materials, enforce access permissions and operate the service. When you use the Voxora AI assistant, your request and relevant current-page text and control labels may be sent to the configured AI provider (Groq) to generate a response or select an action. Password values and local file contents are not included in page context. Public resources are discoverable; private resources are intended for their owner and accounts explicitly shared with.","The current application stores account data, resource metadata and uploaded file bytes in PostgreSQL and is configured for hosted database and Render web hosting. Operator details and provider information should be completed before public launch. This draft is not legal compliance certification."],
    "/terms": ["Terms of use","By using Voxora Access, you agree to use the platform lawfully and respectfully.","You are responsible for the materials you upload and must have the rights or permission needed to store and share them. Choose public or private visibility carefully. Do not upload confidential information unless you have authority and understand the consequences.","The platform is provided on an as-available basis. Embedded previews display supported original files without flattening them into extracted text. Screen-reader access still depends on the document being properly structured and tagged; verify important information against the original material.","These terms may be updated as the service changes. Contact the platform operator for questions."],
    "/cookies": ["Cookie notice","The application uses an essential session cookie to maintain sign-in state and security-related session information.","The session cookie is configured as HTTP-only and SameSite=Lax; the Secure flag is enabled when the application is configured for HTTPS. Blocking essential session cookies may prevent sign-in and account features from working properly.","The reading view uses browser speech synthesis when available. This feature is not described as a cookie. The prototype does not currently provide an analytics or advertising-cookie consent interface."],
    "/acceptable-use": ["Acceptable use policy","Voxora Access is intended to support learning and resource sharing. Everyone using the platform must act lawfully, respectfully and in a way that protects other users.","Do not upload materials you lack permission to distribute, distribute malware, harass others, publish private information without authority, attempt unauthorized access, interfere with platform availability or bypass security controls.","Check content and permissions before uploading. Select public visibility only when you intend the material to be discoverable. Private sharing is limited to selected accounts, but the service is not a secure vault for highly sensitive information."],
    "/copyright": ["Copyright and content reports","Users must upload and share only materials they own or are authorized to use and distribute.","A report should identify the resource, describe the work or right involved, explain why the use is unauthorized and include reliable contact details and supporting information where applicable.","The operator may request more information, restrict access while reviewing a credible report, notify the uploader where appropriate, or restore material if a report is not substantiated. This is not a formal statutory notice-and-counter-notice procedure."]
};

function VoiceAssistant() {
    const navigate = useNavigate();
    const voiceLocation = useLocation();
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
    const messagesRef = useRef((() => {
        try {
            const saved = JSON.parse(window.sessionStorage.getItem("voxora-conversation-v1") || "[]");
            return Array.isArray(saved) ? saved.filter(item =>
                item && ["user", "assistant"].includes(item.role) &&
                typeof item.content === "string"
            ).slice(-20) : [];
        } catch (_) { return []; }
    })());
    const persistConversation = (messages) => {
        messagesRef.current = messages.slice(-20);
        try {
            window.sessionStorage.setItem("voxora-conversation-v1", JSON.stringify(messagesRef.current));
        } catch (_) {}
    };
    const speakingTextRef = useRef("");
    const requestAbortRef = useRef(null);
    const speechQueueRef = useRef([]);
    const headingIndexRef = useRef(0);

    useEffect(() => { activeRef.current = active; }, [active]);
    useEffect(() => { headingIndexRef.current = 0; }, [voiceLocation.pathname]);
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
            recognition.interimResults = true;
            recognition.lang = "en-NG";
            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const transcript = event.results[i][0].transcript.trim();
                    if (!transcript || mutedRef.current) continue;
                    if (speakingRef.current) {
                        const heardWords = normalizeVoiceText(transcript).split(" ").filter(Boolean);
                        const spokenWords = normalizeVoiceText(speakingTextRef.current).split(" ").filter(Boolean);
                        const spokenSet = new Set(spokenWords);
                        const allWordsFromReply = heardWords.length >= 2 && heardWords.every(word => spokenSet.has(word));
                        const heardPhraseInReply = heardWords.length >= 3 && normalizeVoiceText(speakingTextRef.current).includes(heardWords.join(" "));
                        const likelyEcho = allWordsFromReply || heardPhraseInReply;
                        if (likelyEcho) continue;
                        if (!event.results[i].isFinal) {
                            window.speechSynthesis?.cancel();
                            speechQueueRef.current = [];
                            speakingRef.current = false;
                            speakingTextRef.current = "";
                            setSpeaking(false);
                            setNotice("I heard you. Go ahead.");
                            continue;
                        }
                        window.speechSynthesis?.cancel();
                        speechQueueRef.current = [];
                        speakingRef.current = false;
                        speakingTextRef.current = "";
                        setSpeaking(false);
                        if (busyRef.current) {
                            requestAbortRef.current?.abort();
                            busyRef.current = false;
                            setBusy(false);
                        }
                        handleVoiceInput(transcript);
                    } else if (event.results[i].isFinal) {
                        if (busyRef.current) {
                            requestAbortRef.current?.abort();
                            busyRef.current = false;
                            setBusy(false);
                        }
                        handleVoiceInput(transcript);
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
                if (activeRef.current && !mutedRef.current) {
                    window.setTimeout(() => {
                        if (activeRef.current && !mutedRef.current) {
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
        if (!activeRef.current || mutedRef.current || busyRef.current) return;
        try { recognitionRef.current?.start(); } catch (_) {}
    };

    const speak = (text) => {
        if (!("speechSynthesis" in window) || mutedRef.current) {
            resumeListening();
            return;
        }
        const content = String(text || "").trim();
        if (!content) return;
        window.speechSynthesis.cancel();
        speechQueueRef.current = [];
        const sentences = content.match(/[^.!?;]+[.!?;]*/g) || [content];
        let chunk = "";
        for (const sentence of sentences) {
            const next = (chunk + " " + sentence).trim();
            if (next.length > 1000 && chunk) {
                speechQueueRef.current.push(chunk);
                chunk = sentence.trim();
            } else {
                chunk = next;
            }
        }
        if (chunk) speechQueueRef.current.push(chunk);
        speakingRef.current = true;
        speakingTextRef.current = content;
        setSpeaking(true);
        const speakNext = () => {
            if (!speechQueueRef.current.length || mutedRef.current) {
                speakingRef.current = false;
                speakingTextRef.current = "";
                setSpeaking(false);
                resumeListening();
                return;
            }
            const utterance = new SpeechSynthesisUtterance(speechQueueRef.current.shift());
            utterance.rate = 1;
            utterance.onend = speakNext;
            utterance.onerror = speakNext;
            window.speechSynthesis.speak(utterance);
        };
        speakNext();
    };

    const getCurrentPageContext = () => {
        const main = document.querySelector("#main-content");
        return {
            path: window.location.pathname,
            title: document.title,
            text: [(main?.innerText || "").trim(), window.voxoraCurrentResourceText || ""].filter(Boolean).join("\n\n").slice(0, 12000),
            controls: Array.from(main?.querySelectorAll("a,button,input,select,textarea") || [])
                .filter(element => !element.disabled && element.type !== "password" && element.type !== "hidden")
                .slice(0, 35)
                .map(element => ({
                    role: element.tagName.toLowerCase(),
                    label: (element.innerText || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.name || "").trim().slice(0, 120)
                }))
        };
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
            speechQueueRef.current = [];
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

        // Voice-operated navigation stays local to the app unless the user
        // explicitly asks to open an external website.
        const command = text.toLowerCase().replace(/[.!?]+$/, "").trim();

        if (/^(?:please )?(?:read|speak) (?:out )?(?:the )?(?:content of )?(?:this |current )?(?:page|screen|document|resource)(?: to me| aloud)?$|^(read it (to me|aloud)|start reading)$/i.test(command)) {
            const main = document.querySelector("#main-content");
            const documentText = window.voxoraCurrentResourceText || "";
            const pageText = [main?.innerText || document.body.innerText || "", documentText].filter(Boolean).join("\n\n").trim();
            if (!pageText) {
                speak("I cannot find readable page content here.");
            } else {
                setNotice("Reading the current page. You can interrupt me at any time.");
                const prefix = window.voxoraCurrentResourceTruncated
                    ? "I can read the extracted text available for this document. This is an excerpt and may not include every page or visual element. "
                    : "";
                speak(prefix + pageText.slice(0, 12000));
            }
            return;
        }
        if (/^(stop reading|stop talking|be quiet|stop speaking)$/i.test(command)) {
            window.speechSynthesis?.cancel();
            speechQueueRef.current = [];
            speakingRef.current = false;
            speakingTextRef.current = "";
            setSpeaking(false);
            setNotice("Reading stopped.");
            resumeListening();
            return;
        }
        if (/^(explain (this )?(page|screen|document|resource)|what is on this page|what does this page say|summarize this page|explain this content)$/i.test(command)) {
            const pageContext = getCurrentPageContext();
            await askAssistant(text, pageContext);
            return;
        }
        if (/^(next heading|next section|move to next heading)$/i.test(command)) {
            const headings = Array.from(document.querySelectorAll("#main-content h1, #main-content h2, #main-content h3, #main-content h4, #main-content h5, #main-content h6"));
            if (!headings.length) {
                speak("There are no section headings on this page.");
            } else {
                const focusedIndex = headings.indexOf(document.activeElement);
                headingIndexRef.current = Math.min(headings.length - 1, focusedIndex >= 0 ? focusedIndex + 1 : headingIndexRef.current + 1);
                const heading = headings[headingIndexRef.current];
                heading.focus?.();
                heading.setAttribute("tabindex", "-1");
                heading.scrollIntoView({ behavior: "smooth", block: "start" });
                speak(heading.innerText || "Next section.");
            }
            return;
        }
        if (/^(previous heading|previous section|move to previous heading)$/i.test(command)) {
            const headings = Array.from(document.querySelectorAll("#main-content h1, #main-content h2, #main-content h3, #main-content h4, #main-content h5, #main-content h6"));
            if (!headings.length) {
                speak("There are no section headings on this page.");
            } else {
                const focusedIndex = headings.indexOf(document.activeElement);
                headingIndexRef.current = Math.max(0, focusedIndex >= 0 ? focusedIndex - 1 : headingIndexRef.current - 1);
                const heading = headings[headingIndexRef.current];
                heading.setAttribute("tabindex", "-1");
                heading.focus();
                heading.scrollIntoView({ behavior: "smooth", block: "start" });
                speak(heading.innerText || "Previous section.");
            }
            return;
        }
        if (/^(sign me in|log me in|open sign in|open login)$/i.test(command)) {
            if (window.voxoraUser) {
                speak("You are already signed in. What would you like me to do in your workspace?");
            } else {
                navigate("/signin");
                setNotice("Opening sign in. Enter your password directly for security; I can help with the other steps.");
                window.setTimeout(() => document.querySelector('#main-content input[type="email"]')?.focus(), 500);
            }
            return;
        }
        const clickMatch = command.match(/^(?:click|press|activate) (?:the )?(.+)$/i);
        if (clickMatch) {
            const wanted = normalizeVoiceText(clickMatch[1]);
            const candidates = Array.from(document.querySelectorAll("#main-content button, #main-content a, #main-content [role='button'], #main-content input[type='submit']"))
                .filter(element => !element.disabled && element.getAttribute("aria-hidden") !== "true");
            const target = candidates.find(element => normalizeVoiceText(element.innerText || element.value || element.getAttribute("aria-label")) === wanted)
                || candidates.find(element => normalizeVoiceText(element.innerText || element.value || element.getAttribute("aria-label")).includes(wanted));
            if (target) {
                target.focus();
                target.click();
                setNotice("Activated " + (target.innerText || target.getAttribute("aria-label") || "the requested control") + ".");
            } else {
                await askAssistant(text, getCurrentPageContext());
            }
            return;
        }
        const fillMatch = text.match(/^(?:fill|enter|type) (?:in )?(?:the )?(.+?) (?:with|as) (.+)$/i);
        if (fillMatch) {
            const wanted = normalizeVoiceText(fillMatch[1]);
            const value = fillMatch[2].trim();
            const fields = Array.from(document.querySelectorAll("#main-content input, #main-content textarea, #main-content select"))
                .filter(element => !["password", "hidden", "file", "submit", "button"].includes((element.type || "").toLowerCase()) && !element.disabled);
            const field = fields.find(element => {
                const label = element.labels?.[0]?.innerText || element.getAttribute("aria-label") || element.placeholder || element.name || "";
                return normalizeVoiceText(label) === wanted || normalizeVoiceText(label).includes(wanted);
            });
            if (field) {
                field.focus();
                if (field.tagName === "SELECT") {
                    const option = Array.from(field.options).find(item => normalizeVoiceText(item.label || item.text) === normalizeVoiceText(value));
                    if (option) field.value = option.value;
                } else {
                    field.value = value;
                }
                field.dispatchEvent(new Event("input", { bubbles: true }));
                field.dispatchEvent(new Event("change", { bubbles: true }));
                setNotice("Filled " + fillMatch[1] + ". Please review it before submitting.");
            } else if (/password/i.test(fillMatch[1])) {
                speak("For your security, enter your password directly. I can help with the other fields and guide you through signing in.");
            } else {
                await askAssistant(text, getCurrentPageContext());
            }
            return;
        }
        if (/^(scroll down|move down)$/i.test(command)) {
            window.scrollBy({ top: Math.max(400, window.innerHeight * 0.75), behavior: "smooth" });
            setNotice("Scrolling down.");
            return;
        }
        if (/^(scroll up|move up)$/i.test(command)) {
            window.scrollBy({ top: -Math.max(400, window.innerHeight * 0.75), behavior: "smooth" });
            setNotice("Scrolling up.");
            return;
        }
        if (/^(sign me out|log me out|sign out|log out)$/i.test(command)) {
            const form = document.getElementById("voxora-signout-form");
            if (form) {
                form.requestSubmit();
                setNotice("Signing you out.");
            } else {
                navigate("/signin");
                speak("You are not currently signed in. I have opened the sign-in page.");
            }
            return;
        }
        const destinations = [
            { pattern: /^(go to|open|show|take me to) (the )?(home|home page|homepage)$/, path: "/" },
            { pattern: /^(go to|open|show|take me to) (the )?(dashboard|workspace|my workspace)$/, path: "/dashboard" },
            { pattern: /^(go to|open|show|take me to) (the )?(upload page|upload|upload a resource|file upload)$/, path: "/upload" },
            { pattern: /^(go to|open|show|take me to) (my )?(uploads|my uploads|my resources)$/, path: "/my-resources" },
            { pattern: /^(go to|open|show|take me to) (my )?(library|my library|saved resources)$/, path: "/library" },
            { pattern: /^(go to|open|show|take me to) (the )?(shared with me|shared resources)$/, path: "/shared-with-me" },
            { pattern: /^(go to|open|show|take me to) (the )?(account|account settings|profile)$/, path: "/account" },
            { pattern: /^(go to|open|show|take me to) (the )?(sign in|login) page$/, path: "/signin" },
            { pattern: /^(go to|open|show|take me to) (the )?(register|sign up|create account) page$/, path: "/register" },
        ];
        const pageAliases = [
            ...nav.map(([path, label]) => [path, label]),
            ...accountNav.map(([path, label]) => [path, label]),
            ...legal.map(([path, label]) => [path, label]),
            ["/account", "account"], ["/account", "account settings"], ["/account", "profile"],
            ["/signin", "sign in"], ["/signin", "login"],
            ["/register", "register"], ["/register", "sign up"], ["/register", "create account"],
            ["/", "home"], ["/", "homepage"], ["/", "explore resources"],
            ["/my-resources", "my resources"], ["/library", "saved resources"],
            ["/shared-with-me", "shared resources"], ["/dashboard", "workspace"],
            ["/upload", "file upload"], ["/how-it-works", "how it works"],
            ["/acceptable-use", "acceptable use policy"], ["/privacy", "privacy policy"],
        ];
        const cleanPageName = (value) => value.toLowerCase()
            .replace(/^(the|my)\s+/, "")
            .replace(/\s+(page|screen|section)$/, "")
            .replace(/[^a-z0-9]+/g, " ").trim();
        let destination = destinations.find((item) => item.pattern.test(command));
        if (!destination) {
            const requestedPage = command.replace(/^(please\s+)?(go to|open|show|visit|take me to|navigate to)\s+/, "");
            const wanted = cleanPageName(requestedPage);
            const match = pageAliases.find(([path, label]) => cleanPageName(label) === wanted);
            if (match) destination = {path: match[0]};
        }
        if (/^(go back|back|previous page)$/.test(command)) {
            navigate(-1);
            setNotice("Going back to the previous page.");
            return;
        }
        if (/^(go forward|forward|next page)$/.test(command)) {
            navigate(1);
            setNotice("Going forward to the next page.");
            return;
        }
        if (destination) {
            navigate(destination.path);
            setNotice(destination.path === "/upload"
                ? "Opening the upload page. When it appears, select Choose a file to pick a document from your computer."
                : "Opening " + (pageAliases.find(([path]) => path === destination.path)?.[1] || "that page") + ".");
            if (destination.path === "/upload") {
                window.setTimeout(() => {
                    const picker = document.querySelector('input[type="file"]');
                    picker?.focus();
                    picker?.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 700);
            }
            return;
        }
        const externalMatch = command.match(/^(?:open|visit|go to) (?:the website )?(https?:\/\/[^\s]+|www\.[^\s]+)$/i);
        if (externalMatch) {
            const rawUrl = externalMatch[1].startsWith("www.") ? "https://" + externalMatch[1] : externalMatch[1];
            try {
                const target = new URL(rawUrl);
                if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("Unsupported address");
                setNotice("Opening " + target.hostname + ".");
                window.location.assign(target.href);
            } catch (_) {
                setNotice("I couldn't recognise that website address. Please say the full web address.");
            }
            return;
        }
        if (/^(upload|choose|select) (a )?(file|document|something) from (my )?computer$/.test(command)) {
            navigate("/upload");
            setNotice("Opening the upload page. For your privacy, your browser requires you to select the file yourself.");
            window.setTimeout(() => {
                const picker = document.querySelector('input[type="file"]');
                picker?.focus();
                picker?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 700);
            return;
        }

        if (/^(start a new conversation|start fresh|forget this conversation|clear our conversation)$/i.test(command)) {
            persistConversation([]);
            setNotice("Conversation context cleared. We can start fresh.");
            speak("Of course. I've cleared the conversation context for this session. What would you like to do?");
            return;
        }
        await askAssistant(text, getCurrentPageContext());
    };

    const askAssistant = async (text, pageContext = null) => {
        const next = [...messagesRef.current, { role: "user", content: text }].slice(-20);
        persistConversation(next);
        setBusy(true);
        busyRef.current = true;
        setNotice("Voxora is thinking…");
        const controller = new AbortController();
        requestAbortRef.current = controller;
        try {
            const response = await fetch("/api/assistant/chat", {
                method: "POST",
                headers: {"Content-Type": "application/json", "X-CSRF-Token": window.voxoraCsrf || "", Accept: "application/json"},
                credentials: "same-origin",
                signal: controller.signal,
                body: JSON.stringify({ messages: next.slice(-12), page_context: pageContext })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Voxora couldn't respond.");
            const actionResults = result.actions?.length ? executeBrowserActions(result.actions) : [];
            let answer = result.reply || "I'm here. What would you like to do?";
            const failedAction = actionResults.find(item => !item.success);
            if (failedAction) answer = failedAction.message;
            persistConversation([...next, { role: "assistant", content: answer }]);
            setNotice("Voxora is speaking…");
            busyRef.current = false;
            setBusy(false);
            speak(answer);
        } catch (error) {
            if (error.name !== "AbortError") {
                setNotice(error.message + " You can try speaking again.");
                busyRef.current = false;
                setBusy(false);
                resumeListening();
            }
        } finally {
            if (requestAbortRef.current === controller) requestAbortRef.current = null;
        }
    };

    const executeBrowserActions = (actions) => {
        const results = [];
        for (const action of actions) {
            if (!action || typeof action.type !== "string") continue;
            if (action.type === "navigate") {
                const target = String(action.path || "");
                if (target.startsWith("/") && !target.startsWith("//")) {
                    navigate(target);
                    results.push({ success: true, message: "Opening the requested page." });
                } else {
                    results.push({ success: false, message: "I could not open that destination." });
                }
            } else if (action.type === "click") {
                const wanted = normalizeVoiceText(action.label);
                const elements = Array.from(document.querySelectorAll("#main-content button, #main-content a, #main-content [role='button']"));
                const element = elements.find(item => normalizeVoiceText(item.innerText || item.getAttribute("aria-label")) === wanted)
                    || elements.find(item => normalizeVoiceText(item.innerText || item.getAttribute("aria-label")).includes(wanted));
                if (element && !element.disabled) {
                    element.focus();
                    element.click();
                    results.push({ success: true, message: "Activated " + (element.innerText || action.label) + "." });
                } else {
                    results.push({ success: false, message: "I could not find a visible control labelled " + action.label + "." });
                }
            } else if (action.type === "fill") {
                const wanted = normalizeVoiceText(action.label);
                const elements = Array.from(document.querySelectorAll("#main-content input, #main-content textarea, #main-content select"));
                const field = elements.find(item => {
                    if (item.disabled || ["password", "hidden", "file"].includes((item.type || "").toLowerCase())) return false;
                    const label = item.labels?.[0]?.innerText || item.getAttribute("aria-label") || item.placeholder || item.name || "";
                    return normalizeVoiceText(label) === wanted;
                });
                if (field) {
                    field.focus();
                    field.value = String(action.value || "");
                    field.dispatchEvent(new Event("input", { bubbles: true }));
                    field.dispatchEvent(new Event("change", { bubbles: true }));
                    results.push({ success: true, message: "Filled " + action.label + "." });
                } else {
                    results.push({ success: false, message: "I could not find a safe, visible field labelled " + action.label + "." });
                }
            } else if (action.type === "scroll") {
                window.scrollBy({ top: action.direction === "up" ? -window.innerHeight * 0.75 : window.innerHeight * 0.75, behavior: "smooth" });
                results.push({ success: true, message: "Scrolled the page." });
            } else if (action.type === "focus_upload") {
                const focusPicker = () => {
                    const picker = document.querySelector('#main-content input[type="file"]');
                    if (!picker) return false;
                    picker.focus();
                    picker.scrollIntoView({ behavior: "smooth", block: "center" });
                    return true;
                };
                if (!focusPicker()) window.setTimeout(focusPicker, 650);
                setNotice("The file chooser is ready. Select the file in your browser to continue.");
                results.push({ success: true, message: "The upload control is being opened. Select the file in your browser to continue." });
            }
        }
        return results;
    };

    const mute = () => {
        mutedRef.current = true;
        setMuted(true);
        recognitionRef.current?.stop();
        window.speechSynthesis?.cancel();
        speechQueueRef.current = [];
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
        speechQueueRef.current = [];
        speakingRef.current = false;
        setSpeaking(false);
        setNotice("Voice access is paused. Select Enable voice to start again.");
    };

    useEffect(() => {
        // Attempt voice activation on page arrival. Browser permission and user-gesture
        // policies may require the user to press the accessible start control.
        const timer = window.setTimeout(() => startListening(), 500);
        const welcomeTimer = window.setTimeout(() => {
            try {
                if (!window.localStorage.getItem("voxora-welcomed-v1")) {
                    window.localStorage.setItem("voxora-welcomed-v1", "1");
                    speak("Hello, welcome to Voxora Access. I am Voxora, your voice-powered website assistant. I can help you explore the website, find and manage learning resources, understand pages, and complete actions here. You can interrupt me whenever you need. After this welcome, I will stay quiet until you speak to me.");
                }
            } catch (_) {}
        }, 1300);
        return () => {
            window.clearTimeout(timer);
            window.clearTimeout(welcomeTimer);
            activeRef.current = false;
            recognitionRef.current?.stop();
            window.speechSynthesis?.cancel();
            speechQueueRef.current = [];
        };
    }, []);

    return <>
    <div className="voxora-control-dock" role="region" aria-label="Voxora controls">
        <div className="voxora-control-status" role="status" aria-live="polite">
            <span className={"voxora-control-indicator" + (active && !muted ? " is-active" : "")} aria-hidden="true"/>
            <span>{busy ? "Processing" : speaking ? "Speaking" : active && !muted ? "Listening" : muted ? "Microphone muted" : "Voice access paused"}</span>
        </div>
        <button type="button" className="voxora-dock-primary" onClick={startListening}>🎙 {active && !muted ? "Listening on" : "Enable / Resume"}</button>
        <button type="button" onClick={() => muted ? startListening() : mute()}>{muted ? "Unmute mic" : "Mute mic"}</button>
        <button type="button" onClick={() => {
            window.speechSynthesis?.cancel();
            speechQueueRef.current = [];
            speakingRef.current = false;
            speakingTextRef.current = "";
            setSpeaking(false);
            setNotice("Speech stopped. You can speak whenever you're ready.");
            resumeListening();
        }}>■ Stop speaking</button>
        <button type="button" onClick={() => active ? endSession() : startListening()}>{active ? "Ⅱ Pause access" : "▶ Resume access"}</button>
    </div>
    <section className="voxora-voice-access" aria-label="Voxora voice access">
        <div className="voxora-voice-orb" data-state={speaking ? "speaking" : busy ? "thinking" : active && !muted ? "listening" : "idle"} aria-hidden="true">
            <span/>
        </div>
        <h2>Talk to Voxora</h2>
        <p className="voxora-voice-status" role="status" aria-live="polite">{notice}</p>
        <p className="voxora-voice-help">Use the always-visible controls at the bottom of the screen to enable or pause voice access, mute the microphone, or stop speech. Speak naturally to interrupt Voxora while it is replying.</p>
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
    const [localFlash, setLocalFlash] = useState([]);
    const [currentUser, setCurrentUser] = useState(window.voxoraUser);
    const user = currentUser;
    const isDashboardArea = Boolean(user) && (accountNav.some(([href]) => href === path) || path.startsWith("/resource/") || path === "/account");
    useEffect(() => {
        let active = true;
        setError("");
        setData(null);
        const controller = new AbortController();
        fetch("/api/site?path=" + encodeURIComponent(path) + (location.search || ""), {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            signal: controller.signal
        })
            .then((r) => { if (!r.ok) throw new Error("This page could not be loaded."); return r.json(); })
            .then((result) => {
                if (active) {
                    setData(result);
                    window.voxoraCurrentResourceText = result.resource?.text_excerpt || "";
                    window.voxoraCurrentResourceTruncated = Boolean(result.resource?.text_truncated);
                }
            })
            .catch((e) => { if (active && e.name !== "AbortError") setError(e.message); });
        return () => { active = false; controller.abort(); };
    }, [path, location.search]);
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
            setCurrentUser(null);
            window.voxoraUser = null;
            navigate("/");
        } catch (err) {
            setAuthMessage(err.message);
        }
    };
    const signout = <form method="post" action="/signout" onSubmit={handleSignout}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-signout">Sign out</button></form>;
    const Header = () => <header className={"react-topbar" + (isDashboardArea && user ? " react-workspace-topbar" : "")}><AppLink className="react-brand" href={user && isDashboardArea ? "/dashboard" : "/"}><span className="react-brand-mark" aria-hidden="true">V</span><span className="react-brand-copy"><strong>Voxora Access</strong><small>{user && isDashboardArea ? "YOUR LEARNING WORKSPACE" : "Knowledge within everyone's reach."}</small></span></AppLink>{user && isDashboardArea ? <div className="react-topbar-actions react-workspace-actions"><span className="react-user" aria-label="Signed in as">{user.name}</span><AppLink className="react-account-link" href="/account">Account</AppLink>{signout}</div> : <><nav className="react-topbar-actions" aria-label="Main navigation">{nav.map(([href,label])=><AppLink key={href} href={href}>{label}</AppLink>)}</nav><div className="react-topbar-actions">{user ? <><AppLink href="/dashboard">My workspace</AppLink><span className="react-user">{user.name}</span>{signout}</> : <><AppLink href="/signin">Sign in</AppLink><AppLink className="react-primary-button" href="/register">Create account</AppLink></>}</div></>}</header>;
    const Footer = () => <footer className={"react-site-footer" + (isDashboardArea && user ? " react-workspace-footer" : "")}><div><b>Voxora Access</b><p>{isDashboardArea && user ? "Your learning space, built for access." : "Listen. Learn. Explore. Achieve."}</p></div><nav aria-label="Footer navigation">{(isDashboardArea && user ? [] : [...nav,...legal]).map(([href,label])=><AppLink key={href} href={href}>{label}</AppLink>)}</nav><small>© {new Date().getFullYear()} Voxora Access. All rights reserved.</small></footer>;
    const Sidebar = () => user && isDashboardArea ? <aside className="react-sidebar" aria-label="Workspace navigation"><div className="react-sidebar-label">WORKSPACE</div><nav>{accountNav.map(([href,label])=><AppLink key={href} className={path===href?"active":""} aria-current={path===href?"page":undefined} href={href}>{label}</AppLink>)}</nav><div className="react-sidebar-divider"/><div className="react-sidebar-label">ACCOUNT</div><nav><AppLink className={path==="/account"?"active":""} aria-current={path==="/account"?"page":undefined} href="/account">Account settings</AppLink><AppLink href="/signout" onClick={(event)=>{event.preventDefault();document.getElementById("voxora-signout-form")?.requestSubmit();}}>Sign out</AppLink></nav></aside> : null;
    const Frame = ({children}) => <div className="react-site-frame" onSubmit={async(event)=>{const form=event.target;if(event.defaultPrevented)return;const method=(form.method||"GET").toUpperCase();if(method!=="POST")return;const action=new URL(form.action||window.location.href,window.location.origin);if(action.origin!==window.location.origin)return;const isUpload=action.pathname==="/upload";const match=action.pathname.match(/^\/resource\/(\d+)\/(library|share|delete)$/);if(!isUpload&&!match)return;event.preventDefault();try{const response=await fetch(action.pathname+action.search,{method:"POST",body:new FormData(form),credentials:"same-origin",headers:{"X-CSRF-Token":csrf,Accept:"text/html"}});if(!response.ok)throw new Error(response.status===400?"Your security token expired. Refresh the page and try again.":"The action could not be completed. Please check your details and try again.");if(!response.redirected)throw new Error("The server did not confirm the action.");const target=new URL(response.url);setLocalFlash([{category:"success",message:isUpload?"Your resource was uploaded.":match[2]==="share"?"Resource sharing completed.":match[2]==="delete"?"Resource deleted.":"Your library was updated."}]);navigate(target.pathname+target.search);}catch(err){setLocalFlash([{category:"error",message:err.message}]);}}}><AppLink className="react-skip-link" href="#main-content">Skip to main content</AppLink><Header/><div className={isDashboardArea && user ? "react-app-layout" : "react-public-layout"}><Sidebar/><main id="main-content" tabIndex="-1" className="react-page-main">{[...flash, ...localFlash].map((m,i)=><p key={i} className={"flash "+m.category} role="status">{m.message}</p>)}{children}</main></div><Footer/><button className="react-scroll-top" type="button" aria-label="Scroll to top" title="Scroll to top" onClick={()=>window.scrollTo({top:0,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})}>↑<span>Top</span></button><form id="voxora-signout-form" method="post" action="/signout" onSubmit={handleSignout} hidden><input type="hidden" name="_csrf_token" value={csrf}/></form></div>;
    const Cards = ({items}) => <div className="react-feature-grid">{items.map(([title,body])=><article className="react-feature-card" key={title}><h2>{title}</h2><p>{body}</p></article>)}</div>;
    const Resources = ({items,empty}) => items?.length ? <div className="react-card-grid">{items.map(r=><article className="react-content-card" key={r.id}><span className="react-filetype">{(r.extension||"FILE").toUpperCase()}</span><h2><AppLink href={"/resource/"+r.id}>{r.title}</AppLink></h2><p>{r.description || "A shared learning resource."}</p><small>{r.owner_name ? "Shared by "+r.owner_name : (r.visibility||"")} </small><AppLink href={"/resource/"+r.id}>Open resource →</AppLink></article>)}</div> : <div className="react-empty">{empty}</div>;
    const FormField = ({label,...props}) => <label className="react-field">{label}<input {...props}/></label>;
    const Dashboard = () => {
        const [dash,setDash]=useState(null);
        useEffect(()=>{fetch("/api/dashboard").then(r=>{if(!r.ok)throw new Error("Dashboard data unavailable");return r.json()}).then(setDash).catch(e=>setError(e.message))},[]);
        if(!dash)return <section className="react-loading-panel" role="status" aria-live="polite"><div className="react-loader-orbit" aria-hidden="true"><span/></div><h2>Preparing your workspace</h2><p>Gathering your resources and recent activity…</p><div className="react-skeleton-grid" aria-hidden="true"><i/><i/><i/><i/></div><div className="react-skeleton-line" aria-hidden="true"/><div className="react-skeleton-line short" aria-hidden="true"/></section>;
        return <><p className="react-eyebrow">YOUR LEARNING SPACE</p><h1>Welcome back, {dash.user.name.split(" ")[0]}.</h1><p>Pick up where you left off or add something new to your library.</p><AppLink className="react-primary-button" href="/upload">＋ Upload a resource</AppLink><section className="react-stats">{[["Your uploads",dash.stats.uploads],["Public resources",dash.stats.public],["Saved in library",dash.stats.saved],["Shared with you",dash.stats.shared]].map(([k,v])=><article className="react-stat" key={k}><span>{k}</span><strong>{v}</strong></article>)}</section><h2>Recent uploads</h2><Resources items={dash.recent} empty="You haven't uploaded a resource yet."/><h2>Saved for later</h2><Resources items={dash.saved} empty="Your library is waiting for its first resource."/></>;
    };
    if(error)return <Frame><div className="react-error" role="alert">{error} <AppLink href="/">Return home</AppLink></div></Frame>;
    if(!data || data.path !== path)return <div className="react-initial-loading" role="status" aria-live="polite"><div className="react-loader-orbit" aria-hidden="true"><span/></div><strong>Voxora Access</strong><p>Loading this page without restarting voice access…</p><div className="react-loading-track"><span/></div></div>;
    let content;
    if(path==="/") content=<><section className="react-hero"><div><p className="react-eyebrow">KNOWLEDGE WITHIN EVERYONE'S REACH</p><h1>Learning, on your terms.</h1><p>Discover learning resources, organize your materials and listen when reading on screen isn't the easiest option.</p><div className="react-actions"><AppLink className="react-primary-button" href="/register">Create your free account</AppLink><AppLink href="#resources">Explore resources ↓</AppLink></div></div><div className="react-hero-art" aria-hidden="true">V<span>LISTEN · LEARN · EXPLORE</span></div></section><Cards items={[["Discover resources","Browse publicly shared study materials."],["Make it personal","Save useful materials in your own library."],["Choose how to read","Use the reading view and supported browser speech."]]}/><section id="resources"><div className="react-section-heading"><div><p className="react-eyebrow">OPEN KNOWLEDGE</p><h2>Explore public resources</h2></div><form className="react-search" onSubmit={(event)=>{event.preventDefault();const q=String(new FormData(event.currentTarget).get("q")||"").trim();navigate(q?"/?q="+encodeURIComponent(q):"/");}}><input name="q" defaultValue={data.query||""} placeholder="Search by title or topic" aria-label="Search resources"/><button className="react-primary-button">Search</button></form></div><Resources items={data.resources} empty="Public resources will appear here as the community shares learning materials."/></section></>;
    else if(path==="/signin"||path==="/register") {const reg=path==="/register";content=<section className="react-auth"><div><p className="react-eyebrow">WELCOME TO VOXORA ACCESS</p><h1>Learning, on your terms.</h1><p>Keep resources close, discover shared materials, and listen when reading on screen isn't the easiest option.</p></div><form method="post" className="react-form" onSubmit={async(event)=>{event.preventDefault();setAuthMessage("");const form=event.currentTarget;try{const response=await fetch("/api/auth/"+(reg?"register":"signin")+window.location.search,{method:"POST",body:new FormData(form),headers:{"X-CSRF-Token":csrf,Accept:"application/json"},credentials:"same-origin"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Authentication could not be completed.");setCurrentUser(result.user);window.voxoraUser=result.user;if(result.csrf)window.voxoraCsrf=result.csrf;setAuthMessage("");navigate(result.redirect||"/dashboard");}catch(err){setAuthMessage(err.message);}}}><h2>{reg?"Create your account":"Sign in to Voxora Access"}</h2><input type="hidden" name="_csrf_token" value={csrf}/>{reg&&<FormField label="Full name" name="name" autoComplete="name" required maxLength="80"/>}<FormField label="Email" name="email" type="email" autoComplete="email" required/><FormField label="Password" name="password" type="password" autoComplete={reg?"new-password":"current-password"} required minLength={reg?10:undefined}/>{reg&&<small>Use at least 10 characters.</small>}{authMessage&&<p className="react-auth-message" role="alert">{authMessage}</p>}<button className="react-primary-button">{reg?"Create account":"Sign in"}</button><p>{reg?"Already registered? ":"New to Voxora Access? "}<AppLink href={reg?"/signin":"/register"}>{reg?"Sign in":"Create an account"}</AppLink></p></form></section>}
    else if(path==="/dashboard")content=<Dashboard/>;
    else if(path==="/account")content=<><p className="react-eyebrow">ACCOUNT MANAGEMENT</p><h1>Your account</h1><p>Review the details associated with your Voxora Access account.</p><section className="react-account-panel"><div className="react-account-avatar" aria-hidden="true">{(user?.name||"U").trim().charAt(0).toUpperCase()}</div><div><span className="react-account-label">ACCOUNT HOLDER</span><h2>{user?.name||"User"}</h2><p>{user?.email||""}</p></div></section><div className="react-account-settings"><article><div><h2>Personal information</h2><p>Your profile name and email address are used to identify your account.</p></div><dl><div><dt>Full name</dt><dd>{user?.name||"Not available"}</dd></div><div><dt>Email address</dt><dd>{user?.email||"Not available"}</dd></div></dl></article><article><div><h2>Workspace preferences</h2><p>Manage how you access and read learning resources.</p></div><AppLink className="react-secondary-button" href="/preferences">Open preferences</AppLink></article><article><div><h2>Security</h2><p>Always sign out when using a shared or public device. Password management is handled through the sign-in process.</p></div><form method="post" action="/signout" onSubmit={handleSignout}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-danger-button">Sign out of this account</button></form></article></div></>;
    else if(path==="/upload")content=<><p className="react-eyebrow">SHARE KNOWLEDGE</p><h1>Upload a resource</h1><p>Add study materials for your own use or share them publicly.</p><form className="react-form" method="post" encType="multipart/form-data"><input type="hidden" name="_csrf_token" value={csrf}/><FormField as="input" label="Choose a file" name="file" type="file" required accept=".pdf,.docx,.pptx,.txt,.md,.rtf,.csv,.odt,.ods,.odp"/><small>PDF, DOCX, PPTX, TXT, MD, RTF, CSV, ODT, ODS or ODP. Maximum 20 MB by default.</small><FormField label="Resource title" name="title" maxLength="160" placeholder="e.g. Introduction to Biology"/><label className="react-field">Short description<textarea name="description" rows="4" maxLength="1000"/></label><fieldset><legend>Who can access it?</legend><label><input type="radio" name="visibility" value="public" defaultChecked/> Public</label><label><input type="radio" name="visibility" value="private"/> Private</label></fieldset><button className="react-primary-button">Upload resource</button></form></>;
    else if(path==="/my-resources"||path==="/library"||path==="/shared-with-me")content=<><p className="react-eyebrow">YOUR WORKSPACE</p><h1>{path==="/my-resources"?"My uploads":path==="/library"?"My Library":"Shared with me"}</h1><p>{path==="/my-resources"?"Manage resources you've uploaded.":path==="/library"?"Saved resources, ready when you are.":"Private resources shared with your account."}</p><Resources items={data.resources} empty="Nothing to show here yet."/></>;
    else if(path.startsWith("/resource/")&&data.resource){const r=data.resource;const ext=(r.extension||"").toLowerCase();const previewable=["pdf","docx","pptx","txt","md","csv"].includes(ext);const isPdf=ext==="pdf"||ext==="docx"||ext==="pptx";content=<><p><AppLink href="/">Explore</AppLink> / {r.title}</p><p className="react-eyebrow">{r.extension.toUpperCase()} DOCUMENT</p><h1>{r.title}</h1><p>{r.description||"No description provided."}</p><p>Owner: {r.owner_name} · {Math.round(r.size_bytes/1024)} KB · {r.visibility}</p><div className="react-actions"><AppLink className="react-primary-button" href={"/resource/"+r.id+"/read"}>Open document viewer</AppLink><AppLink href={"/resource/"+r.id+"/download"}>Download original</AppLink></div><section className="react-document-panel" aria-labelledby="document-preview-title"><div className="react-document-heading"><div><h2 id="document-preview-title">Document preview</h2><p>DOCX and PPTX files are converted to PDF for in-page viewing. The original file remains available to download.</p></div><AppLink href={"/resource/"+r.id+"/download"}>Open or download original</AppLink></div>{previewable?<iframe className="react-document-frame" title={(isPdf?"PDF preview of "+r.extension.toUpperCase()+": ":"Text document: ")+r.title} src={"/resource/"+r.id+"/preview"} />:<div className="react-document-fallback"><h3>PDF preview is not available</h3><p>The original file is stored safely. The PDF preview may be unavailable if conversion failed or LibreOffice is not installed. You can still download the original document.</p><AppLink className="react-primary-button" href={"/resource/"+r.id+"/download"}>Download {r.extension.toUpperCase()}</AppLink></div>}</section><p className="react-accessibility-note">Accessibility note: an embedded viewer does not automatically make a document accessible. Screen-reader results depend on the document's structure and tags, and scanned PDFs may require OCR.</p>{user&&<form method="post" action={"/resource/"+r.id+"/library"}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-primary-button">{r.in_library?"Remove from My Library":"Add to My Library"}</button></form>}{r.is_owner&&<><h2>Share this resource</h2><form method="post" action={"/resource/"+r.id+"/share"} className="react-form"><input type="hidden" name="_csrf_token" value={csrf}/><FormField label="Account email" name="email" type="email" required placeholder="student@example.edu"/><button className="react-primary-button">Share</button></form><form method="post" action={"/resource/"+r.id+"/delete"} onSubmit={e=>{if(!confirm("Delete this resource permanently?"))e.preventDefault()}}><input type="hidden" name="_csrf_token" value={csrf}/><button className="react-danger-button">Delete resource</button></form></>}</>}
    else if(pageCopy[path]){const [eyebrow,title,lede,items]=pageCopy[path];content=<><p className="react-eyebrow">{eyebrow.toUpperCase()}</p><h1>{title}</h1><p className="react-lede">{lede}</p><Cards items={items}/><AppLink className="react-primary-button" href="/register">Get started</AppLink></>}
    else if(policyCopy[path]){const [title,...paragraphs]=policyCopy[path];content=<article className="react-policy"><p className="react-eyebrow">PLATFORM POLICIES</p><h1>{title}</h1><p className="react-muted">Last updated: 31 October 2026</p>{paragraphs.map((p,i)=><p key={i}>{p}</p>)}</article>}
    else content=<><h1>Page not found</h1><p>The page you're looking for isn't available.</p><AppLink href="/">Return home</AppLink></>;
    return <Frame>{content}</Frame>;
}
createRoot(document.getElementById("voxora-app-root")).render(<BrowserRouter><><App/><VoiceAssistant/></></BrowserRouter>);
