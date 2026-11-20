import { test } from "node:test";
import assert from "node:assert/strict";
import {
    createVoiceActivityDetector,
    isAddressedToVoxora,
    isExplicitBargeInCommand,
    isLikelySpeechEcho,
} from "../src/data/voice.js";

test("speech echo detection rejects exact, partial and lightly misheard phrases", () => {
    const spoken = "A sample passage for assistive reading with the first point";
    assert.equal(isLikelySpeechEcho("A sample passage for assistive reading", spoken), true);
    assert.equal(isLikelySpeechEcho("sample passage assistive reading", spoken), true);
    assert.equal(isLikelySpeechEcho("the first point", spoken), true);
});

test("speech echo detection does not reject an unrelated addressed command", () => {
    const spoken = "A sample passage for assistive reading";
    assert.equal(isLikelySpeechEcho("Voxora, go to dashboard", spoken), false);
    assert.equal(isAddressedToVoxora("Hey Voxora, open my resources"), true);
    assert.equal(isAddressedToVoxora("open my resources"), false);
});

test("explicit interruption phrases are recognised with and without the wake word", () => {
    for (const phrase of ["stop", "stop speaking", "please stop reading", "wait", "hold on", "Voxora, stop", "Hey Voxora, pause"]) {
        assert.equal(isExplicitBargeInCommand(phrase), true, phrase);
    }
    assert.equal(isExplicitBargeInCommand("go to dashboard"), false);
});

test("voice activity detector calibrates ambient sound and rejects short bursts", () => {
    const detect = createVoiceActivityDetector();
    assert.equal(detect(0.004, 0), false);
    assert.equal(detect(0.004, 100), false);
    assert.equal(detect(0.004, 200), false);
    assert.equal(detect(0.004, 300), false);
    assert.equal(detect(0.08, 360), false);
    assert.equal(detect(0.08, 430), false);
    assert.equal(detect(0.08, 500), false);
    assert.equal(detect(0.08, 550), true);
});

test("voice activity detector requires sustained energy and adapts to a noisy baseline", () => {
    const detect = createVoiceActivityDetector();
    for (let time = 0; time <= 400; time += 50) detect(0.02, time);
    assert.equal(detect(0.03, 500), false);
    assert.equal(detect(0.03, 700), false);
    assert.equal(detect(0.08, 750), false);
    assert.equal(detect(0.08, 850), false);
    assert.equal(detect(0.08, 950), true);
});
