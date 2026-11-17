import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { accountNav, legal, nav, normalizeVoiceText } from "../data/navigation.js";

export default function VoiceAssistant() {
    const navigate = useNavigate();
    const voiceLocation = useLocation();
    const [active, setActive] = useState(false);
    const [muted, setMuted] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const [retrySeconds, setRetrySeconds] = useState(0);
    const getScrollBehavior = () => (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth"
    );
    const rateLimitUntilRef = useRef(0);
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
    const headingIndexRef = useRef(-1);
    const speechRunRef = useRef(0);
    const micStreamRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const vadFrameRef = useRef(null);
    const vadMonitorRef = useRef(null);
    const echoCancellationRef = useRef(false);
    const voiceStartRef = useRef(0);
    const voiceActivityUntilRef = useRef(0);
    const noiseFloorRef = useRef(0.005);

    useEffect(() => { activeRef.current = active; }, [active]);
    useEffect(() => { headingIndexRef.current = -1; }, [voiceLocation.pathname]);
    useEffect(() => { mutedRef.current = muted; }, [muted]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (!rateLimitUntilRef.current) return;
            const remaining = Math.max(0, Math.ceil((rateLimitUntilRef.current - Date.now()) / 1000));
            setRetrySeconds(remaining);
            if (remaining === 0) {
                rateLimitUntilRef.current = 0;
                setNotice("The previous AI rate-limit window should have reset. You can try again.");
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const clearPrivateSessionContext = () => {
            persistConversation([]);
            window.voxoraCurrentResourceText = "";
            window.voxoraCurrentResourceTruncated = false;
            interruptSpeech();
            requestAbortRef.current?.abort();
            busyRef.current = false;
            setBusy(false);
        };
        window.addEventListener("voxora:session-ended", clearPrivateSessionContext);
        return () => window.removeEventListener("voxora:session-ended", clearPrivateSessionContext);
    }, []);

    const releaseAudioMonitor = () => {
        if (vadFrameRef.current !== null) {
            window.cancelAnimationFrame(vadFrameRef.current);
            vadFrameRef.current = null;
        }
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach((track) => track.stop());
            micStreamRef.current = null;
        }
        if (audioContextRef.current) {
            const context = audioContextRef.current;
            audioContextRef.current = null;
            try { context.close(); } catch (_) {}
        }
        analyserRef.current = null;
        vadMonitorRef.current = null;
        echoCancellationRef.current = false;
        voiceStartRef.current = 0;
        voiceActivityUntilRef.current = 0;
    };

    const enableEchoCancellation = async () => {
        if (micStreamRef.current && micStreamRef.current.getAudioTracks().some((track) => track.readyState === "live")) {
            return echoCancellationRef.current;
        }
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass) return false;

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                autoGainControl: { ideal: true }
            }
        });
        const track = stream.getAudioTracks()[0];
        const settings = track?.getSettings?.() || {};
        if (settings.echoCancellation !== true) {
            stream.getTracks().forEach((item) => item.stop());
            return false;
        }

        let context;
        try {
            context = new AudioContextClass();
            if (context.state === "suspended") await context.resume();
            const source = context.createMediaStreamSource(stream);
            const analyser = context.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.15;
            source.connect(analyser);

            micStreamRef.current = stream;
            audioContextRef.current = context;
            analyserRef.current = analyser;
            echoCancellationRef.current = true;

            const samples = new Float32Array(analyser.fftSize);
            const monitorVoiceActivity = () => {
                if (!activeRef.current || mutedRef.current || !analyserRef.current) {
                    vadFrameRef.current = null;
                    return;
                }
                analyserRef.current.getFloatTimeDomainData(samples);
                let energy = 0;
                for (let index = 0; index < samples.length; index += 1) {
                    energy += samples[index] * samples[index];
                }
                const rms = Math.sqrt(energy / samples.length);
                const now = performance.now();

                if (rms < 0.014) {
                    noiseFloorRef.current = (noiseFloorRef.current * 0.96) + (rms * 0.04);
                }
                const threshold = Math.max(0.018, noiseFloorRef.current * 3.0);
                if (rms > threshold) {
                    if (!voiceStartRef.current) voiceStartRef.current = now;
                    if (now - voiceStartRef.current >= 180) {
                        voiceActivityUntilRef.current = Date.now() + 1500;
                    }
                } else if (!voiceStartRef.current || now - voiceStartRef.current > 180) {
                    voiceStartRef.current = 0;
                }
                vadFrameRef.current = window.requestAnimationFrame(monitorVoiceActivity);
            };
            vadMonitorRef.current = monitorVoiceActivity;
            return true;
        } catch (error) {
            stream.getTracks().forEach((item) => item.stop());
            if (context) {
                try { await context.close(); } catch (_) {}
            }
            return false;
        }
    };

    const interruptSpeech = () => {
        speechRunRef.current += 1;
        window.speechSynthesis?.cancel();
        speechQueueRef.current = [];
        speakingRef.current = false;
        speakingTextRef.current = "";
        setSpeaking(false);
    };

    const startListening = async () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setNotice("This browser does not support voice recognition. Try Chrome or Edge, or use your device's screen reader.");
            return;
        }

        let echoReady = echoCancellationRef.current;
        try {
            echoReady = await enableEchoCancellation();
        } catch (_) {
            echoReady = false;
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
                        // Only accept a spoken interruption when the independently
                        // captured, echo-cancelled microphone signal contains near-end
                        // voice activity. Without AEC, recognition is paused during TTS.
                        if (!echoCancellationRef.current || Date.now() > voiceActivityUntilRef.current) {
                            continue;
                        }
                        const heardWords = normalizeVoiceText(transcript).split(" ").filter(Boolean);
                        const spokenWords = normalizeVoiceText(speakingTextRef.current).split(" ").filter(Boolean);
                        const spokenSet = new Set(spokenWords);
                        const overlap = heardWords.length
                            ? heardWords.filter((word) => spokenSet.has(word)).length / heardWords.length
                            : 0;
                        const likelyEcho = heardWords.length >= 2 && (
                            heardWords.every((word) => spokenSet.has(word)) ||
                            (heardWords.length >= 3 && overlap >= 0.82)
                        );
                        if (likelyEcho) continue;

                        if (!event.results[i].isFinal) {
                            interruptSpeech();
                            setNotice("I heard you. Go ahead.");
                            continue;
                        }
                        interruptSpeech();
                        if (busyRef.current) {
                            requestAbortRef.current?.abort();
                            busyRef.current = false;
                            setBusy(false);
                        }
                        voiceActivityUntilRef.current = 0;
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
                    recognitionRef.current?.stop();
                    releaseAudioMonitor();
                    setNotice("Microphone permission is needed. Select Enable voice and allow microphone access in your browser.");
                } else if (event.error === "audio-capture") {
                    activeRef.current = false;
                    setActive(false);
                    recognitionRef.current?.stop();
                    releaseAudioMonitor();
                    setNotice("The microphone is unavailable. Check that it is connected and not being used exclusively by another application.");
                } else if (event.error !== "no-speech" && event.error !== "aborted") {
                    setNotice("Voice recognition paused. Select Resume listening to try again.");
                }
            };
            recognition.onend = () => {
                if (activeRef.current && !mutedRef.current && (!speakingRef.current || echoCancellationRef.current)) {
                    window.setTimeout(() => {
                        if (activeRef.current && !mutedRef.current && (!speakingRef.current || echoCancellationRef.current)) {
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
        if (echoReady && vadMonitorRef.current && vadFrameRef.current === null) {
            vadFrameRef.current = window.requestAnimationFrame(vadMonitorRef.current);
        }

        if (speakingRef.current && !echoReady) {
            setNotice("Your browser cannot provide echo cancellation. Voxora will resume listening after it finishes speaking; use Stop speaking to interrupt.");
            return;
        }

        try {
            recognitionRef.current.start();
            setNotice(echoReady
                ? "Listening with echo cancellation. You can interrupt while Voxora is speaking."
                : "Listening. Echo cancellation is unavailable, so microphone recognition pauses while Voxora speaks.");
        } catch (error) {
            if (error?.name !== "InvalidStateError") {
                activeRef.current = false;
                setActive(false);
                recognitionRef.current?.stop();
                releaseAudioMonitor();
                setNotice("Your browser needs a tap to enable the microphone. Select Enable voice.");
            }
        }
    };

    const resumeListening = () => {
        if (!activeRef.current || mutedRef.current || busyRef.current) return;
        if (speakingRef.current && !echoCancellationRef.current) return;
        try { recognitionRef.current?.start(); } catch (_) {}
    };

    const speak = (text) => {
        if (!("speechSynthesis" in window) || mutedRef.current) {
            resumeListening();
            return;
        }
        const content = String(text || "").trim();
        if (!content) return;

        const runId = ++speechRunRef.current;
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

        // If the browser cannot provide an echo-cancelled microphone signal,
        // use safe half-duplex mode rather than allowing TTS to trigger STT.
        if (!echoCancellationRef.current) recognitionRef.current?.stop();

        const speakNext = () => {
            if (runId !== speechRunRef.current) return;
            if (!speechQueueRef.current.length || mutedRef.current) {
                speakingRef.current = false;
                speakingTextRef.current = "";
                setSpeaking(false);
                resumeListening();
                return;
            }
            const segment = speechQueueRef.current.shift();
            speakingTextRef.current = segment;
            const utterance = new SpeechSynthesisUtterance(segment);
            utterance.rate = 1;
            utterance.onend = () => {
                if (runId === speechRunRef.current) speakNext();
            };
            utterance.onerror = () => {
                if (runId === speechRunRef.current) speakNext();
            };
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
            controls: Array.from(main?.querySelectorAll("a,button,input,select,textarea,[role='button'],[role='checkbox'],[role='switch']") || [])
                .filter(element => !element.disabled && element.getAttribute("aria-hidden") !== "true" && element.type !== "password" && element.type !== "hidden" && element.getClientRects().length > 0)
                .slice(0, 35)
                .map((element, index) => {
                    const label = element.labels?.[0]?.innerText || element.innerText || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("title") || element.name || "";
                    return {
                        index: index + 1,
                        role: element.getAttribute("role") || element.tagName.toLowerCase(),
                        type: (element.type || "").toLowerCase(),
                        label: label.trim().slice(0, 120),
                        options: element.tagName === "SELECT" ? Array.from(element.options).slice(0, 8).map(option => option.text.trim().slice(0, 80)) : undefined
                    };
                })
        };
    };

    const handleVoiceInput = async (rawText) => {
        const text = rawText.trim();
        if (!text || busyRef.current) return;
        const command = text.toLowerCase().replace(/[.!?]+$/, "").trim();
        if (/^(voxora[,. ]+)?(mute yourself|mute)$/i.test(command)) {
            mute();
            return;
        }
        if (/^(voxora[,. ]+)?(stop speaking|be quiet)$/i.test(command)) {
            interruptSpeech();
            resumeListening();
            return;
        }
        if (/^(voxora[,. ]+)?(stop listening|end voice session)$/i.test(command)) {
            endSession();
            return;
        }

        // Voice-operated navigation stays local to the app unless the user
        // explicitly asks to open an external website.
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
        if (/^(stop reading|stop talking)$/i.test(command)) {
            interruptSpeech();
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
                headingIndexRef.current = Math.min(
                    headings.length - 1,
                    focusedIndex >= 0 ? focusedIndex + 1 : Math.max(0, headingIndexRef.current + 1)
                );
                const heading = headings[headingIndexRef.current];
                heading.setAttribute("tabindex", "-1");
                heading.focus({ preventScroll: true });
                heading.scrollIntoView({ behavior: getScrollBehavior(), block: "start" });
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
                heading.scrollIntoView({ behavior: getScrollBehavior(), block: "start" });
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
            const results = await executeBrowserActions([{ type: "click", label: clickMatch[1] }]);
            if (!results[0]?.success && !/more than one|several controls/i.test(results[0]?.message || "")) {
                await askAssistant(text, getCurrentPageContext());
            } else {
                const message = results[0]?.message || "I could not complete that click.";
                setNotice(message);
                speak(message);
            }
            return;
        }
        const fillMatch = text.match(/^(?:fill|enter|type) (?:in )?(?:the )?(.+?) (?:with|as) (.+)$/i);
        if (fillMatch) {
            if (/password/i.test(fillMatch[1])) {
                speak("For your security, enter your password directly. I can help with the other fields and guide you through signing in.");
            } else {
                const results = await executeBrowserActions([{ type: "fill", label: fillMatch[1], value: fillMatch[2].trim() }]);
                if (!results[0]?.success) {
                    await askAssistant(text, getCurrentPageContext());
                } else {
                    const message = results[0].message + " Please review the field before submitting.";
                    setNotice(message);
                    speak(message);
                }
            }
            return;
        }
        if (/^(scroll down|move down)$/i.test(command)) {
            window.scrollBy({ top: Math.max(400, window.innerHeight * 0.75), behavior: getScrollBehavior() });
            setNotice("Scrolling down.");
            return;
        }
        if (/^(scroll up|move up)$/i.test(command)) {
            window.scrollBy({ top: -Math.max(400, window.innerHeight * 0.75), behavior: getScrollBehavior() });
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
                    picker?.scrollIntoView({ behavior: getScrollBehavior(), block: "center" });
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
                picker?.scrollIntoView({ behavior: getScrollBehavior(), block: "center" });
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
        const cooldown = Math.max(0, Math.ceil((rateLimitUntilRef.current - Date.now()) / 1000));
        if (cooldown > 0) {
            setRetrySeconds(cooldown);
            setNotice(`Voxora's AI service is cooling down. Please try again in ${cooldown} seconds.`);
            return;
        }
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
                body: JSON.stringify({ messages: next.slice(-8), page_context: pageContext })
            });
            const result = await response.json();
            if (!response.ok) {
                const requestError = new Error(result.error || "Voxora couldn't respond.");
                requestError.code = result.code || "";
                requestError.retryAfterSeconds = result.retry_after_seconds;
                throw requestError;
            }
            const actionResults = result.actions?.length ? await executeBrowserActions(result.actions, controller.signal) : [];
            if (controller.signal.aborted) return;
            let answer = result.reply || "I'm here. What would you like to do?";
            const failedAction = actionResults.find((item) => !item.success);
            if (failedAction) {
                answer = failedAction.message;
            } else if (actionResults.length) {
                answer = answer.replace(/queued for the browser|the browser will attempt to /gi, "completed: ");
            }
            if (result.data_changed) {
                window.dispatchEvent(new Event("voxora:data-changed"));
            }
            persistConversation([...next, { role: "assistant", content: answer }]);
            setNotice("Voxora is speaking…");
            busyRef.current = false;
            setBusy(false);
            speak(answer);
        } catch (error) {
            if (error.name !== "AbortError") {
                if (["rate_limit", "token_limit", "request_limit"].includes(error.code)) {
                    const waitSeconds = Number(error.retryAfterSeconds || 0);
                    if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
                        rateLimitUntilRef.current = Date.now() + waitSeconds * 1000;
                        setRetrySeconds(waitSeconds);
                        setNotice(`${error.message} Voxora will be ready to retry in about ${waitSeconds} seconds.`);
                    } else {
                        setNotice(error.message + " Groq did not provide a reset time, so Voxora will not retry automatically.");
                    }
                } else {
                    setNotice(error.message + " You can try speaking again.");
                }
                busyRef.current = false;
                setBusy(false);
                resumeListening();
            }
        } finally {
            if (requestAbortRef.current === controller) requestAbortRef.current = null;
        }
    };

    const executeBrowserActions = async (actions, signal = null) => {
        const results = [];
        const isAborted = () => Boolean(signal?.aborted);
        const wait = (milliseconds) => new Promise(resolve => window.setTimeout(resolve, milliseconds));
        const isVisible = (element) => Boolean(
            element && !element.disabled &&
            element.getAttribute("aria-hidden") !== "true" &&
            element.getClientRects().length > 0
        );
        const controlLabel = (element) => {
            const label = element.labels?.[0]?.innerText ||
                element.getAttribute("aria-label") ||
                element.innerText ||
                element.value ||
                element.getAttribute("placeholder") ||
                element.getAttribute("title") ||
                element.name || "";
            return normalizeVoiceText(label);
        };
        const findUniqueControl = (selector, label) => {
            const wanted = normalizeVoiceText(label);
            const candidates = Array.from(document.querySelectorAll(selector)).filter(isVisible);
            const exact = candidates.filter(element => controlLabel(element) === wanted);
            if (exact.length === 1) return { element: exact[0] };
            if (exact.length > 1) return { error: "I found more than one control with that exact label. Please be more specific." };
            const partial = candidates.filter(element => controlLabel(element).includes(wanted));
            if (partial.length === 1) return { element: partial[0] };
            if (partial.length > 1) return { error: "Several controls match that description. Please use the full label." };
            return { error: "I could not find a visible control labelled " + label + "." };
        };
        const waitForPageReady = async (expectedPath, timeout = 9000) => {
            const started = Date.now();
            while (Date.now() - started < timeout && !isAborted()) {
                const main = document.querySelector("#main-content");
                const loading = main?.querySelector(".react-route-loading");
                if (window.location.pathname === expectedPath && main && !loading && main.innerText.trim()) {
                    return true;
                }
                await wait(100);
            }
            return false;
        };
        const setNativeValue = (element, value) => {
            const prototype = element.tagName === "TEXTAREA"
                ? window.HTMLTextAreaElement.prototype
                : element.tagName === "SELECT"
                    ? window.HTMLSelectElement.prototype
                    : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            if (setter) setter.call(element, value);
            else element.value = value;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
        };

        for (const action of actions) {
            if (isAborted()) break;
            if (!action || typeof action.type !== "string") continue;
            let result = null;

            if (action.type === "navigate") {
                const target = String(action.path || "");
                if (!target.startsWith("/") || target.startsWith("//")) {
                    result = { success: false, message: "I could not open that destination." };
                } else {
                    const targetUrl = new URL(target, window.location.origin);
                    navigate(target);
                    const ready = await waitForPageReady(targetUrl.pathname);
                    const heading = document.querySelector("#main-content h1")?.innerText?.trim();
                    result = ready
                        ? { success: true, message: "Opened " + (heading || targetUrl.pathname) + "." }
                        : { success: false, message: "The requested page did not finish loading, so I stopped the remaining actions." };
                }
            } else if (action.type === "click") {
                const found = findUniqueControl(
                    "#main-content button, #main-content a, #main-content [role='button'], #main-content input[type='submit'], #main-content input[type='button']",
                    action.label
                );
                if (!found.element) {
                    result = { success: false, message: found.error };
                } else {
                    const element = found.element;
                    const beforePath = window.location.pathname;
                    const beforeText = document.querySelector("#main-content")?.innerText || "";
                    const targetHref = element.tagName === "A" ? element.href : "";
                    const form = element.closest("form");
                    const submitsForm = Boolean(form && (
                        element.type === "submit" ||
                        element.getAttribute("type") === "submit" ||
                        (element.tagName === "BUTTON" && !element.getAttribute("type"))
                    ));
                    element.focus();
                    if (submitsForm && form && !form.checkValidity()) {
                        form.reportValidity();
                        result = { success: false, message: "The form needs a few required fields completed before I can submit it." };
                    } else {
                        element.click();
                    }
                    if (!result && targetHref) {
                        try {
                            const targetUrl = new URL(targetHref, window.location.origin);
                            if (targetUrl.origin === window.location.origin && targetUrl.pathname !== beforePath) {
                                const ready = await waitForPageReady(targetUrl.pathname);
                                if (!ready) {
                                    result = { success: false, message: "The link was activated, but the destination did not finish loading." };
                                }
                            }
                        } catch (_) {}
                    } else if (!result && submitsForm) {
                        const started = Date.now();
                        let completed = false;
                        while (Date.now() - started < 12000 && !isAborted()) {
                            const main = document.querySelector("#main-content");
                            const errorNotice = main?.querySelector(".flash.error, [role='alert']");
                            const successNotice = main?.querySelector(".flash.success, [role='status']");
                            if (window.location.pathname !== beforePath) {
                                completed = await waitForPageReady(window.location.pathname);
                                break;
                            }
                            if (successNotice?.innerText?.trim()) {
                                completed = true;
                                break;
                            }
                            if (errorNotice?.innerText?.trim()) {
                                result = { success: false, message: errorNotice.innerText.trim() };
                                break;
                            }
                            if (!form.isConnected || (main?.innerText || "") !== beforeText) {
                                completed = true;
                                break;
                            }
                            await wait(150);
                        }
                        if (!result) {
                            result = completed
                                ? { success: true, message: "Submitted " + (action.label || "the form") + "." }
                                : { success: false, message: "I activated the submit control, but could not verify the result. Please check the page before trying again." };
                        }
                    }
                    if (!result) {
                        await wait(120);
                        result = { success: true, message: "Activated " + (element.innerText || element.getAttribute("aria-label") || action.label) + "." };
                    }
                }
            } else if (action.type === "fill") {
                const found = findUniqueControl(
                    "#main-content input, #main-content textarea, #main-content select",
                    action.label
                );
                if (!found.element) {
                    result = { success: false, message: found.error };
                } else if (["password", "hidden", "file", "submit", "button"].includes((found.element.type || "").toLowerCase())) {
                    result = { success: false, message: "For security, I cannot fill password or file controls. Please enter or select those yourself." };
                } else {
                    found.element.focus();
                    setNativeValue(found.element, String(action.value ?? ""));
                    result = { success: true, message: "Filled " + action.label + ". Please review it before submitting." };
                }
            } else if (action.type === "select_option") {
                const found = findUniqueControl("#main-content select", action.label);
                if (!found.element) {
                    result = { success: false, message: found.error };
                } else {
                    const wanted = normalizeVoiceText(action.option);
                    const options = Array.from(found.element.options);
                    const matches = options.filter(option =>
                        normalizeVoiceText(option.text || option.label) === wanted ||
                        normalizeVoiceText(option.value) === wanted
                    );
                    if (matches.length !== 1) {
                        result = { success: false, message: matches.length ? "More than one dropdown option matches. Please specify the exact option." : "I could not find the option " + action.option + "." };
                    } else {
                        found.element.focus();
                        setNativeValue(found.element, matches[0].value);
                        result = { success: true, message: "Selected " + matches[0].text + " in " + action.label + "." };
                    }
                }
            } else if (action.type === "set_checkbox") {
                const wanted = normalizeVoiceText(action.label);
                const candidates = Array.from(document.querySelectorAll(
                    "#main-content input[type='checkbox'], #main-content [role='checkbox'], #main-content [role='switch']"
                )).filter(isVisible);
                const matches = candidates.filter(element => controlLabel(element) === wanted || controlLabel(element).includes(wanted));
                if (matches.length !== 1) {
                    result = { success: false, message: matches.length ? "Several checkboxes match that description. Please use the full label." : "I could not find a visible checkbox labelled " + action.label + "." };
                } else {
                    const checkbox = matches[0];
                    checkbox.focus();
                    if (checkbox.type === "checkbox") {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
                        if (setter) setter.call(checkbox, Boolean(action.checked));
                        else checkbox.checked = Boolean(action.checked);
                        checkbox.dispatchEvent(new Event("input", { bubbles: true }));
                        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
                    } else {
                        const current = checkbox.getAttribute("aria-checked") === "true";
                        if (current !== Boolean(action.checked)) checkbox.click();
                    }
                    result = { success: true, message: (action.checked ? "Checked " : "Unchecked ") + action.label + "." };
                }
            } else if (action.type === "scroll") {
                window.scrollBy({ top: action.direction === "up" ? -window.innerHeight * 0.75 : window.innerHeight * 0.75, behavior: getScrollBehavior() });
                result = { success: true, message: "Scrolled the page " + action.direction + "." };
            } else if (action.type === "focus_upload") {
                const started = Date.now();
                let picker = null;
                while (Date.now() - started < 7000 && !picker && !isAborted()) {
                    picker = document.querySelector('#main-content input[type="file"]');
                    if (!picker) await wait(100);
                }
                if (picker) {
                    picker.focus();
                    picker.scrollIntoView({ behavior: getScrollBehavior(), block: "center" });
                    result = { success: true, message: "The upload control is ready. Select the file in your browser to continue." };
                } else {
                    result = { success: false, message: "I could not find the upload control on this page." };
                }
            }

            if (result) {
                results.push(result);
                if (!result.success) break;
            }
        }
        return results;
    };

    const mute = () => {
        mutedRef.current = true;
        setMuted(true);
        recognitionRef.current?.stop();
        interruptSpeech();
        releaseAudioMonitor();
        setNotice("Microphone muted. Select Resume listening when you are ready.");
    };

    const endSession = () => {
        activeRef.current = false;
        mutedRef.current = false;
        setActive(false);
        setMuted(false);
        recognitionRef.current?.stop();
        interruptSpeech();
        releaseAudioMonitor();
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
            speechRunRef.current += 1;
            recognitionRef.current?.stop();
            window.speechSynthesis?.cancel();
            speechQueueRef.current = [];
            releaseAudioMonitor();
        };
    }, []);

    useEffect(() => {
        if (!notice || busy || speaking) return undefined;
        const timer = window.setTimeout(() => setNotice(""), 4800);
        return () => window.clearTimeout(timer);
    }, [notice, busy, speaking]);

    return <>
    <div className={"voxora-assistant-notice" + (!notice ? " is-empty" : busy ? " is-busy" : speaking ? " is-speaking" : "")} role="status" aria-live="polite" aria-atomic="true">
        {notice && <>
            <span className="voxora-assistant-notice-dot" aria-hidden="true"/>
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss Voxora notification" onClick={() => setNotice("")}>×</button>
        </>}
    </div>
    <div className="voxora-control-dock" role="region" aria-label="Voxora controls">
        <div className="voxora-control-status" role="status" aria-live="polite" aria-atomic="true">
            <span className={"voxora-control-indicator" + (active && !muted ? " is-active" : "")} aria-hidden="true"/>
            <span>{retrySeconds > 0 ? "AI cooldown" : busy ? "Processing" : speaking ? (echoCancellationRef.current ? "Speaking · interruptible" : "Speaking · listening paused") : active && !muted ? "Listening" : muted ? "Microphone muted" : "Voice access paused"}</span>
            {retrySeconds > 0 && <span aria-hidden="true">· {retrySeconds}s</span>}
        </div>
        <button type="button" className="voxora-dock-primary" onClick={startListening}><span aria-hidden="true">🎙</span> {active && !muted ? "Listening on" : "Enable / Resume"}</button>
        <button type="button" aria-pressed={muted} onClick={() => muted ? startListening() : mute()}>Mute microphone</button>
        <button type="button" onClick={() => {
            interruptSpeech();
            setNotice("Speech stopped. You can speak whenever you're ready.");
            resumeListening();
        }}><span aria-hidden="true">■</span> Stop speaking</button>
        <button type="button" onClick={() => active ? endSession() : startListening()}><span aria-hidden="true">{active ? "Ⅱ" : "▶"}</span> {active ? "Pause access" : "Resume access"}</button>
    </div>
    </>;
}
