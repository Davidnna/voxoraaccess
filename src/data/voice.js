import { normalizeVoiceText } from "./navigation.js";

const DEFAULT_VOICE_ACTIVITY_OPTIONS = Object.freeze({
    minimumRms: 0.018,
    attackMs: 180,
    calibrationMs: 350,
    noiseMultiplier: 2.4,
    releaseMultiplier: 1.6,
    maximumNoiseFloor: 0.025,
});

export function isExplicitBargeInCommand(value) {
    const command = normalizeVoiceText(value)
        .replace(/^(?:hey )?voxora\s+/, "")
        .trim();
    return /^(?:please )?(?:stop(?: speaking| reading| talking)?|pause|wait|hold on|interrupt|be quiet|cancel)(?: please)?$/.test(command);
}

export function isAddressedToVoxora(value) {
    const command = normalizeVoiceText(value);
    return /^(?:hey )?voxora\s+\S/.test(command);
}

function longestCommonSubsequenceLength(left, right) {
    if (!left.length || !right.length) return 0;
    let previous = new Array(right.length + 1).fill(0);
    for (const leftWord of left) {
        const current = new Array(right.length + 1).fill(0);
        for (let index = 1; index <= right.length; index += 1) {
            current[index] = leftWord === right[index - 1]
                ? previous[index - 1] + 1
                : Math.max(previous[index], current[index - 1]);
        }
        previous = current;
    }
    return previous[right.length];
}

function bigramCoverage(heardWords, spokenWords) {
    if (heardWords.length < 3 || spokenWords.length < 3) return 0;
    const spokenBigrams = new Set();
    for (let index = 0; index < spokenWords.length - 1; index += 1) {
        spokenBigrams.add(`${spokenWords[index]} ${spokenWords[index + 1]}`);
    }
    let matched = 0;
    let total = 0;
    for (let index = 0; index < heardWords.length - 1; index += 1) {
        total += 1;
        if (spokenBigrams.has(`${heardWords[index]} ${heardWords[index + 1]}`)) matched += 1;
    }
    return total ? matched / total : 0;
}

/**
 * Compare recognition output with Voxora's active/recent speech. Browser ASR
 * often changes punctuation, drops short words or returns only a phrase from
 * the current utterance, so exact substring checks are not sufficient.
 */
export function isLikelySpeechEcho(transcript, spokenText) {
    const heardWords = normalizeVoiceText(transcript).split(" ").filter(Boolean);
    const spokenWords = normalizeVoiceText(spokenText).split(" ").filter(Boolean);
    if (!heardWords.length || !spokenWords.length) return false;

    const spokenSet = new Set(spokenWords);
    if (heardWords.length === 1) return spokenSet.has(heardWords[0]);

    const heardPhrase = ` ${heardWords.join(" ")} `;
    const spokenPhrase = ` ${spokenWords.join(" ")} `;
    if (spokenPhrase.includes(heardPhrase)) return true;
    if (heardWords.every((word) => spokenSet.has(word))) return true;

    const matchedWords = longestCommonSubsequenceLength(heardWords, spokenWords);
    const orderedCoverage = matchedWords / heardWords.length;
    const heardSet = new Set(heardWords);
    const intersection = [...heardSet].filter((word) => spokenSet.has(word)).length;
    const union = new Set([...heardSet, ...spokenSet]).size;
    const jaccard = union ? intersection / union : 0;
    const phraseCoverage = bigramCoverage(heardWords, spokenWords);

    return (
        (heardWords.length >= 3 && orderedCoverage >= 0.78 && jaccard >= 0.48) ||
        (heardWords.length >= 4 && phraseCoverage >= 0.66) ||
        (heardWords.length >= 3 && jaccard >= 0.76)
    );
}

/**
 * Stateful microphone activity detector. It learns a short ambient-noise
 * baseline, requires sustained near-end energy, and uses a small hold window
 * so natural gaps between syllables do not close the barge-in gate.
 */
export function createVoiceActivityDetector(options = {}) {
    const settings = { ...DEFAULT_VOICE_ACTIVITY_OPTIONS, ...options };
    let calibrationStartedAt = null;
    let noiseFloor = 0.005;
    let voiceStartedAt = null;

    const sample = (rms, now) => {
        if (!Number.isFinite(rms) || !Number.isFinite(now) || rms < 0) return false;
        if (calibrationStartedAt === null) calibrationStartedAt = now;

        if (now - calibrationStartedAt < settings.calibrationMs) {
            const boundedLevel = Math.min(rms, settings.maximumNoiseFloor);
            noiseFloor = Math.min(
                settings.maximumNoiseFloor,
                noiseFloor * 0.82 + boundedLevel * 0.18,
            );
            return false;
        }

        const startThreshold = Math.max(
            settings.minimumRms,
            noiseFloor * settings.noiseMultiplier,
        );
        const releaseThreshold = Math.max(
            settings.minimumRms * 0.55,
            noiseFloor * settings.releaseMultiplier,
        );

        if (rms >= startThreshold) {
            if (voiceStartedAt === null) voiceStartedAt = now;
            return now - voiceStartedAt >= settings.attackMs;
        }

        if (rms <= releaseThreshold) {
            voiceStartedAt = null;
            noiseFloor = Math.min(
                settings.maximumNoiseFloor,
                noiseFloor * 0.985 + Math.min(rms, settings.maximumNoiseFloor) * 0.015,
            );
        } else if (voiceStartedAt === null) {
            voiceStartedAt = null;
        }
        return false;
    };

    sample.reset = () => {
        calibrationStartedAt = null;
        noiseFloor = 0.005;
        voiceStartedAt = null;
    };
    sample.getNoiseFloor = () => noiseFloor;
    return sample;
}
