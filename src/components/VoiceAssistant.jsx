import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { accountNav, legal, nav, normalizeVoiceText } from "../data/navigation.js";

const WELCOME_TEXT = "Hello, welcome to Voxora Access. I am Voxora, your voice-powered website assistant. I can help you explore the website, find and manage learning resources, understand pages, and complete actions here. On supported browsers, you can interrupt me while I speak, or use the Stop speaking control. After this welcome, I will stay quiet until you speak to me.";

export default function VoiceAssistant() {
    const navigate = useNavigate();
    const voiceLocation = useLocation();
    const [active, setActive] = useState(false);
    const [muted, setMuted] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const [footerVisible, setFooterVisible] = useState(false);
    const [dockExpanded, setDockExpanded] = useState(false);
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
    const requestAbortRef = useRef(null);
    const speechQueueRef = useRef([]);
    const speechWatchdogRef = useRef(null);
    const speechEndWatchdogRef = useRef(null);
    const pendingSpeechRef = useRef(null);
    const welcomePendingRef = useRef(false);
    const welcomeGestureHandlerRef = useRef(null);
    const headingIndexRef = useRef(-1);
    const speechRunRef = useRef(0);
    const speakRef = useRef(null);
    const interruptSpeechRef = useRef(null);
    const recognitionListeningRef = useRef(false);
    const ignoreRecognitionResultsRef = useRef(false);
    const recognitionStopWaiterRef = useRef(null);
    const recognitionStopTimerRef = useRef(null);
    const resumeListeningTimerRef = useRef(null);
    const audioOutputGuardUntilRef = useRef(0);
    const microphoneMonitorRef = useRef({ stream: null, context: null, source: null, analyser: null, frameId: null });
    const echoMonitorReadyRef = useRef(false);
    const microphoneMonitorPromiseRef = useRef(null);
    const microphoneMonitorGenerationRef = useRef(0);
    const userVoiceUntilRef = useRef(0);
    const voiceAboveThresholdFramesRef = useRef(0);
    const microphoneNoiseFloorRef = useRef(0.002);

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

    // Keep a separate echo-cancelled microphone monitor active while the
    // browser's SpeechRecognition service listens. The monitor is used only
    // for voice-activity detection; it never supplies or stores speech audio.
    // Recognition results received during TTS are accepted only when this
    // processed monitor detects recent user speech. If echo cancellation is
    // unavailable, fall back to half-duplex rather than risk self-triggering.
    const stopMicrophoneMonitor = () => {
        const monitor = microphoneMonitorRef.current;
        microphoneMonitorGenerationRef.current += 1;
        if (monitor.frameId !== null) window.cancelAnimationFrame(monitor.frameId);
        try { monitor.source?.disconnect(); } catch (_) {}
        try { monitor.analyser?.disconnect(); } catch (_) {}
        monitor.stream?.getTracks?.().forEach(track => track.stop());
        try { monitor.context?.close?.(); } catch (_) {}
        microphoneMonitorRef.current = { stream: null, context: null, source: null, analyser: null, frameId: null };
        echoMonitorReadyRef.current = false;
        userVoiceUntilRef.current = 0;
        voiceAboveThresholdFramesRef.current = 0;
        microphoneNoiseFloorRef.current = 0.002;
        microphoneMonitorPromiseRef.current = null;
    };

    const startMicrophoneMonitor = () => {
        if (echoMonitorReadyRef.current) return Promise.resolve(true);
        if (microphoneMonitorPromiseRef.current) return microphoneMonitorPromiseRef.current;
        if (!navigator.mediaDevices?.getUserMedia) return Promise.resolve(false);

        const generation = microphoneMonitorGenerationRef.current;
        const pending = (async () => {
            let stream = null;
            let context = null;
            try {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) return false;
                // Create/resume the audio context synchronously from the Enable
                // voice gesture, before the permission request yields control.
                context = new AudioContextClass();
                if (context.state === "suspended") await context.resume();
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                });
                if (generation !== microphoneMonitorGenerationRef.current || !activeRef.current || mutedRef.current) {
                    stream.getTracks().forEach(item => item.stop());
                    await context.close();
                    return false;
                }
                const track = stream.getAudioTracks?.()[0];
                const settings = track?.getSettings?.() || {};
                if (settings.echoCancellation === false) {
                    stream.getTracks().forEach(item => item.stop());
                    await context.close();
                    return false;
                }
                if (context.state !== "running") {
                    stream.getTracks().forEach(item => item.stop());
                    await context.close();
                    return false;
                }
                const source = context.createMediaStreamSource(stream);
                const analyser = context.createAnalyser();
                analyser.fftSize = 2048;
                analyser.smoothingTimeConstant = 0.12;
                source.connect(analyser);

                microphoneMonitorRef.current = { stream, context, source, analyser, frameId: null };
                echoMonitorReadyRef.current = true;
                const samples = new Float32Array(analyser.fftSize);
                const sampleMicrophone = () => {
                    const monitor = microphoneMonitorRef.current;
                    if (!echoMonitorReadyRef.current || !monitor.analyser) return;
                    monitor.analyser.getFloatTimeDomainData(samples);
                    let sum = 0;
                    let zeroCrossings = 0;
                    for (let index = 0; index < samples.length; index += 1) {
                        const sample = samples[index];
                        sum += sample * sample;
                        if (index > 0 && ((samples[index - 1] <= 0 && sample > 0) || (samples[index - 1] >= 0 && sample < 0))) {
                            zeroCrossings += 1;
                        }
                    }
                    const rms = Math.sqrt(sum / samples.length);
                    const zeroCrossingRate = zeroCrossings / samples.length;
                    const speechLikeSignal = zeroCrossingRate >= 0.008 && zeroCrossingRate <= 0.35;
                    const noiseFloor = microphoneNoiseFloorRef.current;
                    const threshold = Math.max(0.008, noiseFloor * 3.0);
                    if (!speakingRef.current && rms < threshold) {
                        microphoneNoiseFloorRef.current = (noiseFloor * 0.995) + (rms * 0.005);
                    }
                    if (rms >= threshold && speechLikeSignal) {
                        voiceAboveThresholdFramesRef.current += 1;
                        if (voiceAboveThresholdFramesRef.current >= 4) {
                            userVoiceUntilRef.current = Date.now() + 2400;
                        }
                    } else {
                        voiceAboveThresholdFramesRef.current = Math.max(0, voiceAboveThresholdFramesRef.current - 1);
                    }
                    monitor.frameId = window.requestAnimationFrame(sampleMicrophone);
                };
                microphoneMonitorRef.current.frameId = window.requestAnimationFrame(sampleMicrophone);
                return true;
            } catch (_) {
                stream?.getTracks?.().forEach(track => track.stop());
                try { await context?.close?.(); } catch (_) {}
                return false;
            }
        })();
        microphoneMonitorPromiseRef.current = pending;
        return pending.finally(() => {
            if (microphoneMonitorPromiseRef.current === pending) microphoneMonitorPromiseRef.current = null;
        });
    };

    const finishRecognitionStopWait = (expectedRecognition = null) => {
        const waiter = recognitionStopWaiterRef.current;
        if (!waiter || (expectedRecognition && waiter.recognition !== expectedRecognition)) return;
        recognitionStopWaiterRef.current = null;
        if (recognitionStopTimerRef.current !== null) {
            window.clearTimeout(recognitionStopTimerRef.current);
            recognitionStopTimerRef.current = null;
        }
        waiter.resolve();
    };

    const stopRecognition = (abort = false) => {
        const recognition = recognitionRef.current;
        if (!recognition || !recognitionListeningRef.current) return;
        try {
            if (abort && typeof recognition.abort === "function") recognition.abort();
            else recognition.stop();
        } catch (_) {
            recognitionListeningRef.current = false;
            if (recognitionRef.current === recognition) recognitionRef.current = null;
        }
    };

    const waitForRecognitionToStop = () => {
        const recognition = recognitionRef.current;
        const existingWaiter = recognitionStopWaiterRef.current;
        if (existingWaiter && existingWaiter.recognition === recognition) return existingWaiter.promise;
        if (!recognition || !recognitionListeningRef.current) return Promise.resolve();

        let resolveWait;
        const promise = new Promise((resolve) => { resolveWait = resolve; });
        recognitionStopWaiterRef.current = { recognition, resolve: resolveWait, promise };
        recognitionStopTimerRef.current = window.setTimeout(() => {
            // Defensive fallback for browsers that fail to dispatch onend.
            try { recognition.abort?.(); } catch (_) {}
            recognitionListeningRef.current = false;
            if (recognitionRef.current === recognition) recognitionRef.current = null;
            finishRecognitionStopWait(recognition);
            if (!speakingRef.current) resumeListening(650);
        }, 1500);

        try {
            if (typeof recognition.abort === "function") recognition.abort();
            else recognition.stop();
        } catch (_) {
            recognitionListeningRef.current = false;
            if (recognitionRef.current === recognition) recognitionRef.current = null;
            finishRecognitionStopWait(recognition);
        }
        return promise;
    };

    const createRecognition = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setNotice("This browser does not support voice recognition. Try Chrome or Edge, or use your device's screen reader.");
            return null;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-NG";
        recognition.onstart = () => {
            if (recognitionRef.current === recognition) recognitionListeningRef.current = true;
        };
        recognition.onresult = (event) => {
            // Results from an ended recognition instance are stale. Never
            // accept them after a new recognition session has been created.
            if (recognitionRef.current !== recognition) return;
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                if (!activeRef.current || ignoreRecognitionResultsRef.current || mutedRef.current || !event.results[i].isFinal) continue;
                const transcript = event.results[i][0].transcript.trim();
                if (!transcript) continue;

                const recentUserVoice = echoMonitorReadyRef.current && Date.now() <= userVoiceUntilRef.current;
                if (speakingRef.current) {
                    // During playback, ignore anything not corroborated by the
                    // echo-cancelled microphone monitor. A real voice result
                    // interrupts TTS before the new command is handled.
                    if (!recentUserVoice) continue;
                    interruptSpeechRef.current?.({ userBargeIn: true });
                } else if (Date.now() < audioOutputGuardUntilRef.current && !recentUserVoice) {
                    continue;
                }

                if (busyRef.current) {
                    requestAbortRef.current?.abort();
                    busyRef.current = false;
                    setBusy(false);
                }
                handleVoiceInput(transcript);
                return;
            }
        };
        recognition.onerror = (event) => {
            if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                activeRef.current = false;
                recognitionListeningRef.current = false;
                if (recognitionRef.current === recognition) recognitionRef.current = null;
                finishRecognitionStopWait(recognition);
                setActive(false);
                try { recognition.stop(); } catch (_) {}
                setNotice("Microphone permission is needed. Select Enable voice and allow microphone access in your browser.");
            } else if (event.error === "audio-capture") {
                activeRef.current = false;
                recognitionListeningRef.current = false;
                if (recognitionRef.current === recognition) recognitionRef.current = null;
                finishRecognitionStopWait(recognition);
                setActive(false);
                try { recognition.stop(); } catch (_) {}
                setNotice("The microphone is unavailable. Check that it is connected and not being used exclusively by another application.");
            } else if (event.error !== "no-speech" && event.error !== "aborted") {
                setNotice("Voice recognition paused. Select Resume listening to try again.");
            }
        };
        recognition.onend = () => {
            const isCurrentRecognition = recognitionRef.current === recognition;
            if (isCurrentRecognition) {
                recognitionListeningRef.current = false;
                recognitionRef.current = null;
            }
            finishRecognitionStopWait(recognition);
            if (isCurrentRecognition && activeRef.current && !mutedRef.current && (!speakingRef.current || echoMonitorReadyRef.current) && !busyRef.current) {
                resumeListening(350);
            }
        };
        recognitionRef.current = recognition;
        return recognition;
    };

    const clearSpeechWatchdog = () => {
        if (speechWatchdogRef.current !== null) {
            window.clearTimeout(speechWatchdogRef.current);
            speechWatchdogRef.current = null;
        }
        if (speechEndWatchdogRef.current !== null) {
            window.clearTimeout(speechEndWatchdogRef.current);
            speechEndWatchdogRef.current = null;
        }
    };

    const removeWelcomeGestureListener = () => {
        const handler = welcomeGestureHandlerRef.current;
        if (!handler) return;
        document.removeEventListener("pointerdown", handler, true);
        document.removeEventListener("keydown", handler, true);
        welcomeGestureHandlerRef.current = null;
    };

    const interruptSpeech = ({ userBargeIn = false } = {}) => {
        const wasSpeaking = speakingRef.current || Boolean(window.speechSynthesis?.speaking);
        speechRunRef.current += 1;
        clearSpeechWatchdog();
        window.speechSynthesis?.cancel();
        speechQueueRef.current = [];
        pendingSpeechRef.current = null;
        welcomePendingRef.current = false;
        removeWelcomeGestureListener();
        speakingRef.current = false;
        ignoreRecognitionResultsRef.current = false;
        setSpeaking(false);
        if (wasSpeaking) {
            audioOutputGuardUntilRef.current = Date.now() + (userBargeIn ? 180 : 500);
            if (!recognitionListeningRef.current) resumeListening(userBargeIn ? 100 : 500);
        }
    };

    const startListening = () => {
        activeRef.current = true;
        mutedRef.current = false;
        setActive(true);
        setMuted(false);
        if (resumeListeningTimerRef.current !== null) {
            window.clearTimeout(resumeListeningTimerRef.current);
            resumeListeningTimerRef.current = null;
        }

        const beginRecognition = () => {
            if (!activeRef.current || mutedRef.current) return;
            let recognition = recognitionRef.current;
            if (!recognition) recognition = createRecognition();
            if (!recognition || recognitionListeningRef.current) return;
            try {
                ignoreRecognitionResultsRef.current = false;
                recognitionListeningRef.current = true;
                recognition.start();
                setNotice(echoMonitorReadyRef.current
                    ? "Listening. You can interrupt Voxora while it speaks."
                    : "Listening. Voxora will pause recognition during speech on this browser to prevent audio feedback.");
            } catch (error) {
                if (error?.name !== "InvalidStateError") {
                    recognitionListeningRef.current = false;
                    activeRef.current = false;
                    if (recognitionRef.current === recognition) recognitionRef.current = null;
                    setActive(false);
                    try { recognition.stop(); } catch (_) {}
                    setNotice("Your browser needs a tap to enable the microphone. Select Enable voice.");
                }
            }
        };

        // Start the echo-cancelled monitor from the user's microphone gesture.
        // SpeechRecognition can start immediately while Voxora is silent; if
        // playback is already active, wait for the monitor before opening the
        // recognition path so Voxora cannot transcribe its own voice.
        const monitorPromise = startMicrophoneMonitor();
        if (speakingRef.current && !echoMonitorReadyRef.current) {
            setNotice("Preparing echo-aware listening so you can interrupt Voxora safely…");
            monitorPromise.then((ready) => {
                if (!activeRef.current || mutedRef.current) return;
                if (ready) beginRecognition();
                else setNotice("Voice interruption is unavailable on this browser right now. Use Stop speaking, then speak your command.");
            });
            return;
        }
        beginRecognition();
        monitorPromise.then((ready) => {
            if (!ready || !activeRef.current || mutedRef.current || !speakingRef.current) return;
            if (!recognitionListeningRef.current) {
                beginRecognition();
            } else if (recognitionStopWaiterRef.current) {
                // If speech started just before the echo monitor became ready,
                // wait for the fallback recognition shutdown, then reopen it
                // under the echo-aware barge-in gate.
                recognitionStopWaiterRef.current.promise.then(beginRecognition);
            }
        });
    };

    const resumeListening = (minimumDelay = 700) => {
        if (!activeRef.current || mutedRef.current || busyRef.current || (speakingRef.current && !echoMonitorReadyRef.current)) return;
        if (resumeListeningTimerRef.current !== null) {
            window.clearTimeout(resumeListeningTimerRef.current);
            resumeListeningTimerRef.current = null;
        }
        const quietDelay = Math.max(minimumDelay, audioOutputGuardUntilRef.current - Date.now());
        resumeListeningTimerRef.current = window.setTimeout(() => {
            resumeListeningTimerRef.current = null;
            if (!activeRef.current || mutedRef.current || busyRef.current || (speakingRef.current && !echoMonitorReadyRef.current)) return;
            let recognition = recognitionRef.current;
            if (!recognition) recognition = createRecognition();
            if (!recognition || recognitionListeningRef.current) return;
            try {
                ignoreRecognitionResultsRef.current = false;
                recognitionListeningRef.current = true;
                recognition.start();
                setNotice("Listening.");
            } catch (error) {
                if (error?.name !== "InvalidStateError") {
                    recognitionListeningRef.current = false;
                    if (recognitionRef.current === recognition) recognitionRef.current = null;
                    setNotice("Voice recognition could not resume. Select Resume listening to try again.");
                }
            }
        }, quietDelay);
    };

    const speak = (text, options = {}) => {
        const welcome = Boolean(options.welcome);
        const userGesture = Boolean(options.userGesture);
        const content = String(text || "").trim();
        if (!content) return false;

        const synthesis = window.speechSynthesis;
        const Utterance = window.SpeechSynthesisUtterance;
        if (!synthesis || typeof Utterance !== "function") {
            speakingRef.current = false;
            setSpeaking(false);
            setNotice("This browser does not support Voxora voice playback. Use your device's screen reader or a supported browser with speech synthesis enabled.");
            if (welcome) {
                welcomePendingRef.current = true;
                pendingSpeechRef.current = { text: content, welcome: true };
            }
            return false;
        }

        const runId = ++speechRunRef.current;
        clearSpeechWatchdog();
        const previousSpeechActive = Boolean(
            speakingRef.current || synthesis.speaking || synthesis.pending
        );
        if (previousSpeechActive) {
            try { synthesis.cancel(); } catch (_) {}
        }
        if (synthesis.paused) {
            try { synthesis.resume(); } catch (_) {}
        }

        speechQueueRef.current = [];
        const sentences = content.match(/[^.!?;]+[.!?;]*/g) || [content];
        let chunk = "";
        for (const sentence of sentences) {
            for (const word of sentence.trim().split(/\s+/)) {
                if (!word) continue;
                const next = (chunk + " " + word).trim();
                if (next.length > 900 && chunk) {
                    speechQueueRef.current.push(chunk);
                    chunk = word;
                } else {
                    chunk = next;
                }
            }
        }
        if (chunk) speechQueueRef.current.push(chunk);

        // Microphone mute affects input only. It must never disable speaker output.
        speakingRef.current = true;
        const echoAwareBargeIn = echoMonitorReadyRef.current;
        ignoreRecognitionResultsRef.current = !echoAwareBargeIn;
        setSpeaking(true);
        setNotice(echoAwareBargeIn
            ? "Preparing Voxora's spoken response. You can interrupt by speaking."
            : "Preparing Voxora's spoken response. Microphone listening will pause to prevent audio feedback.");
        pendingSpeechRef.current = null;
        if (welcome) {
            welcomePendingRef.current = true;
        } else if (!options.preserveWelcome) {
            welcomePendingRef.current = false;
            removeWelcomeGestureListener();
        }
        if (resumeListeningTimerRef.current !== null) {
            window.clearTimeout(resumeListeningTimerRef.current);
            resumeListeningTimerRef.current = null;
        }

        const finish = () => {
            if (runId !== speechRunRef.current) return;
            clearSpeechWatchdog();
            speakingRef.current = false;
            ignoreRecognitionResultsRef.current = false;
            setSpeaking(false);
            audioOutputGuardUntilRef.current = Date.now() + (echoAwareBargeIn ? 350 : 900);
            resumeListening(echoAwareBargeIn ? 350 : 900);
        };

        const fail = (reason) => {
            if (runId !== speechRunRef.current) return;
            clearSpeechWatchdog();
            speechRunRef.current += 1;
            try { synthesis.cancel(); } catch (_) {}
            speechQueueRef.current = [];
            speakingRef.current = false;
            ignoreRecognitionResultsRef.current = false;
            setSpeaking(false);
            audioOutputGuardUntilRef.current = Date.now() + 900;
            const detail = String(reason || "playback did not start").replace(/[-_]/g, " ");
            pendingSpeechRef.current = { text: content, welcome };
            if (welcome) {
                welcomePendingRef.current = true;
                setNotice("Voxora could not start the welcome audio automatically. Interact with the page to try again.");
            } else {
                setNotice(`Voxora could not play audio (${detail}). Check your device media volume and browser audio settings.`);
            }
            resumeListening(900);
        };

        const speakNext = () => {
            if (runId !== speechRunRef.current) return;
            if (!speechQueueRef.current.length) {
                if (welcome) {
                    welcomePendingRef.current = false;
                    pendingSpeechRef.current = null;
                    removeWelcomeGestureListener();
                }
                finish();
                return;
            }

            const segment = speechQueueRef.current.shift();
            const utterance = new Utterance(segment);
            utterance.rate = 0.96;
            utterance.pitch = 1;
            utterance.volume = 1;
            const preferredLanguage = (navigator.language || "en-NG").toLowerCase();
            const languageBase = preferredLanguage.split("-")[0];
            try {
                const voices = synthesis.getVoices?.() || [];
                const selectedVoice = voices.find((voice) => voice.lang?.toLowerCase() === preferredLanguage)
                    || voices.find((voice) => voice.lang?.toLowerCase().startsWith(`${languageBase}-`))
                    || voices.find((voice) => /^en(?:-|$)/i.test(voice.lang || ""))
                    || voices.find((voice) => voice.default)
                    || voices[0];
                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                    utterance.lang = selectedVoice.lang || preferredLanguage;
                } else {
                    utterance.lang = /^en(?:-|$)/i.test(preferredLanguage) ? preferredLanguage : "en-US";
                }
            } catch (_) {
                utterance.lang = /^en(?:-|$)/i.test(preferredLanguage) ? preferredLanguage : "en-US";
            }

            let started = false;
            clearSpeechWatchdog();
            speechWatchdogRef.current = window.setTimeout(() => {
                if (runId === speechRunRef.current && !started) fail("playback did not start");
            }, 7000);

            utterance.onstart = () => {
                if (runId !== speechRunRef.current) return;
                started = true;
                if (speechWatchdogRef.current !== null) {
                    window.clearTimeout(speechWatchdogRef.current);
                    speechWatchdogRef.current = null;
                }
                setSpeaking(true);
                setNotice(echoAwareBargeIn
                    ? "Voxora is speaking. You can interrupt at any time by speaking."
                    : "Voxora is speaking. Microphone listening is paused to prevent audio feedback.");
                // Some browsers fire onstart but never deliver onend. Do not leave
                // the interface permanently stuck in the speaking state.
                speechEndWatchdogRef.current = window.setTimeout(() => {
                    if (runId === speechRunRef.current) fail("playback stalled");
                }, Math.max(15000, Math.min(120000, segment.length * 120)));
            };

            utterance.onend = () => {
                if (runId !== speechRunRef.current) return;
                if (speechEndWatchdogRef.current !== null) {
                    window.clearTimeout(speechEndWatchdogRef.current);
                    speechEndWatchdogRef.current = null;
                }
                if (speechQueueRef.current.length) {
                    speakNext();
                    return;
                }
                if (welcome) {
                    welcomePendingRef.current = false;
                    pendingSpeechRef.current = null;
                    removeWelcomeGestureListener();
                }
                finish();
            };

            utterance.onerror = (event) => {
                if (runId !== speechRunRef.current) return;
                fail(event?.error || "speech error");
            };

            try {
                synthesis.speak(utterance);
            } catch (error) {
                fail(error?.name || "speech error");
            }
        };

        const beginSpeechQueue = () => {
            const engineResetDelay = previousSpeechActive ? (userGesture ? 80 : 120) : 0;
            window.setTimeout(() => {
                if (runId !== speechRunRef.current) return;
                if (echoAwareBargeIn && activeRef.current && !mutedRef.current && !recognitionListeningRef.current) {
                    resumeListening(0);
                }
                speakNext();
            }, engineResetDelay + 180);
        };
        if (recognitionListeningRef.current && !echoAwareBargeIn) {
            waitForRecognitionToStop().then(beginSpeechQueue);
        } else {
            beginSpeechQueue();
        }
        return true;
    };

    speakRef.current = speak;
    interruptSpeechRef.current = interruptSpeech;

    useEffect(() => {
        const readDocument = () => {
            const text = String(window.voxoraCurrentResourceText || "").trim();
            if (!text) {
                setNotice("No extracted document text is available to read yet.");
                return;
            }
            const limited = Boolean(window.voxoraCurrentResourceTruncated);
            setNotice(limited
                ? "Preparing audio for all extracted text. The source document may contain additional content not extracted by Voxora…"
                : "Preparing the complete extracted document for audio…");
            speakRef.current?.((limited ? "The source document was partially extracted. I will read all text currently available to Voxora. " : "") + text);
        };
        const stopDocument = () => {
            interruptSpeechRef.current?.();
            setNotice("Document reading stopped.");
        };
        window.addEventListener("voxora:read-document", readDocument);
        window.addEventListener("voxora:stop-reading", stopDocument);
        return () => {
            window.removeEventListener("voxora:read-document", readDocument);
            window.removeEventListener("voxora:stop-reading", stopDocument);
        };
    }, []);

    const getCurrentPageContext = () => {
        const main = document.querySelector("#main-content");
        const readerContent = main?.querySelector(".react-document-reading-content")?.innerText || "";
        const readerStatus = main?.querySelector(".react-extraction-status")?.innerText || "";
        const resourceText = window.voxoraCurrentResourceText || "";
        const pageText = readerContent
            ? [readerContent, readerStatus].filter(Boolean).join("\n\n")
            : (main?.innerText || resourceText);
        return {
            path: window.location.pathname,
            title: document.title,
            text: pageText.trim().slice(0, 12000),
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
        if (/^(?:(?:hey )?voxora[,. ]+)?(stop|stop speaking|be quiet|wait|hold on|pause|interrupt)$/i.test(command)) {
            interruptSpeech();
            resumeListening(150);
            setNotice("Voxora stopped speaking. I'm listening.");
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
            const readerContent = main?.querySelector(".react-document-reading-content")?.innerText || "";
            const pageText = (readerContent || main?.innerText || document.body.innerText || documentText).trim();
            if (!pageText) {
                speak("I cannot find readable page content here.");
            } else {
                const limited = Boolean(window.voxoraCurrentResourceTruncated);
                setNotice(limited
                    ? "Preparing audio for all extracted page text. Some source content may not have been extracted…"
                    : "Preparing the complete page for audio…");
                const prefix = limited
                    ? "The source document was partially extracted. I will read all text currently available to Voxora. "
                    : "";
                speak(prefix + pageText);
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
            setNotice("Preparing Voxora's spoken response…");
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
        stopRecognition();
        stopMicrophoneMonitor();
        setNotice("Microphone muted. Voxora can still speak; select Unmute microphone to resume listening.");
    };

    const endSession = () => {
        activeRef.current = false;
        mutedRef.current = false;
        setActive(false);
        setMuted(false);
        stopRecognition();
        stopMicrophoneMonitor();
        interruptSpeech();
        setNotice("Voice access is paused. Select Enable voice to start again.");
    };

    useEffect(() => {
        // A new page load is a new visit. Do not let a sessionStorage flag
        // suppress the greeting after the user reloads or reopens the website.
        // The browser may still require a real user gesture before audio starts.
        const welcomeEnabled = window.voxoraWelcomeEnabled !== false;
        if (welcomeEnabled) {
            welcomePendingRef.current = true;
            pendingSpeechRef.current = { text: WELCOME_TEXT, welcome: true };
        }

        const retryPendingSpeechFromGesture = (event) => {
            if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
            const target = event.target;
            const dockButton = target?.closest?.(".voxora-control-dock button");
            if (dockButton && !dockButton.classList.contains("voxora-dock-primary") && !dockButton.classList.contains("voxora-footer-toggle")) return;

            if (speakingRef.current) return;
            const pending = pendingSpeechRef.current || (welcomePendingRef.current
                ? { text: WELCOME_TEXT, welcome: true }
                : null);
            if (!pending) return;
            speakRef.current?.(pending.text, { welcome: pending.welcome, userGesture: true });
        };

        if (welcomeEnabled) {
            welcomeGestureHandlerRef.current = retryPendingSpeechFromGesture;
            document.addEventListener("pointerdown", retryPendingSpeechFromGesture, { capture: true, passive: true });
            document.addEventListener("keydown", retryPendingSpeechFromGesture, true);
        }

        const welcomeTimer = welcomeEnabled ? window.setTimeout(() => {
            if (welcomePendingRef.current && pendingSpeechRef.current?.welcome) {
                speakRef.current?.(WELCOME_TEXT, { welcome: true });
            }
        }, 1300) : null;

        // Load available system voices early. Several mobile browsers populate
        // getVoices() asynchronously and can otherwise start a silent utterance.
        const synthesis = window.speechSynthesis;
        const warmVoices = () => {
            try { synthesis?.getVoices?.(); } catch (_) {}
        };
        warmVoices();
        synthesis?.addEventListener?.("voiceschanged", warmVoices);

        // Resume hands-free listening only after explicit microphone permission.
        const resumeTimer = window.setTimeout(async () => {
            try {
                const permission = await navigator.permissions?.query({ name: "microphone" });
                if (permission?.state === "granted") startListening();
            } catch (_) {}
        }, 700);

        return () => {
            if (welcomeTimer !== null) window.clearTimeout(welcomeTimer);
            window.clearTimeout(resumeTimer);
            removeWelcomeGestureListener();
            synthesis?.removeEventListener?.("voiceschanged", warmVoices);
            activeRef.current = false;
            speechRunRef.current += 1;
            clearSpeechWatchdog();
            stopRecognition();
            stopMicrophoneMonitor();
            recognitionListeningRef.current = false;
            recognitionRef.current = null;
            finishRecognitionStopWait();
            if (resumeListeningTimerRef.current !== null) window.clearTimeout(resumeListeningTimerRef.current);
            if (recognitionStopTimerRef.current !== null) window.clearTimeout(recognitionStopTimerRef.current);
            synthesis?.cancel();
            speechQueueRef.current = [];
            pendingSpeechRef.current = null;
        };
    }, []);

    useEffect(() => {
        setFooterVisible(false);
        setDockExpanded(false);
        if (typeof window.IntersectionObserver !== "function") return undefined;
        const root = document.querySelector("#voxora-app-root") || document.body;
        let observedFooter = null;
        let footerObserver = null;
        const observeFooter = () => {
            const footer = document.querySelector(".react-site-footer");
            if (!footer || footer === observedFooter) return;
            footerObserver?.disconnect();
            observedFooter = footer;
            footerObserver = new window.IntersectionObserver((entries) => {
                const visible = entries.some((entry) => entry.isIntersecting);
                setFooterVisible(visible);
                if (!visible) setDockExpanded(false);
            }, { threshold: 0.01 });
            footerObserver.observe(footer);
        };
        observeFooter();
        const mutationObserver = typeof window.MutationObserver === "function"
            ? new window.MutationObserver(observeFooter)
            : null;
        mutationObserver?.observe(root, { childList: true, subtree: true });
        return () => {
            mutationObserver?.disconnect();
            footerObserver?.disconnect();
            observedFooter = null;
        };
    }, [voiceLocation.pathname]);

    useEffect(() => {
        const dock = document.querySelector(".voxora-control-dock");
        if (!dock) return undefined;
        const root = document.documentElement;
        const updateDockHeight = () => {
            const height = Math.ceil(dock.getBoundingClientRect().height);
            root.style.setProperty("--voxora-control-dock-height", `${height}px`);
        };
        updateDockHeight();
        let observer = null;
        if (typeof window.ResizeObserver === "function") {
            observer = new window.ResizeObserver(updateDockHeight);
            observer.observe(dock);
        }
        window.addEventListener("resize", updateDockHeight, { passive: true });
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", updateDockHeight);
            root.style.removeProperty("--voxora-control-dock-height");
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
    <div className={"voxora-control-dock" + (footerVisible ? " is-footer-visible" : "") + (dockExpanded ? " is-expanded" : "")} role="region" aria-label="Voxora controls">
        <div className="voxora-control-status" role="status" aria-live="polite" aria-atomic="true">
            <span className={"voxora-control-indicator" + (active && !muted ? " is-active" : "")} aria-hidden="true"/>
            <span>{retrySeconds > 0 ? "AI cooldown" : busy ? "Processing" : speaking ? (echoMonitorReadyRef.current ? "Speaking · ready for interruption" : "Speaking · microphone paused") : active && !muted ? "Listening" : muted ? "Microphone muted" : "Voice access paused"}</span>
            {retrySeconds > 0 && <span aria-hidden="true">· {retrySeconds}s</span>}
        </div>
        {(!footerVisible || dockExpanded) && <>
            <button type="button" className="voxora-dock-primary" onClick={startListening}><span aria-hidden="true">🎙</span> {active && !muted ? "Listening on" : "Enable / Resume"}</button>
            <button type="button" className="voxora-microphone-toggle" data-microphone-state={muted ? "muted" : active ? "listening" : "inactive"} aria-pressed={Boolean(active && !muted)} onClick={() => (muted || !active) ? startListening() : mute()}>{muted ? "Unmute microphone" : active ? "Mute microphone" : "Enable microphone"}</button>
            <button type="button" onClick={() => {
                interruptSpeech();
                setNotice("Speech stopped. You can speak whenever you're ready.");
                resumeListening();
            }}><span aria-hidden="true">■</span> Stop speaking</button>
            <button type="button" onClick={() => active ? endSession() : startListening()}><span aria-hidden="true">{active ? "Ⅱ" : "▶"}</span> {active ? "Pause access" : "Resume access"}</button>
        </>}
        {footerVisible && <button type="button" className="voxora-footer-toggle" aria-expanded={dockExpanded} onClick={() => {
            setDockExpanded((current) => !current);
        }}>{dockExpanded ? "Collapse controls" : "Voxora controls"}</button>}
    </div>
    </>;
}
