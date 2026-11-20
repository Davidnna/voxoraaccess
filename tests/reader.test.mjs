import test from "node:test";
import assert from "node:assert/strict";
import {
    buildReadingSections,
    buildReadingSegments,
    buildSegmentTargetMap,
    findCurrentSectionIndex,
    isDocumentReadCommand,
} from "../src/data/reader.js";

test("reading segments preserve heading and paragraph order", () => {
    const segments = buildReadingSegments([
        { type: "heading", level: 2, text: "Introduction" },
        { type: "paragraph", text: "First paragraph." },
        { type: "heading", level: 3, text: "Study aims" },
        { type: "paragraph", text: "Second paragraph." },
        { type: "page_break", page: 2 },
    ]);
    assert.deepEqual(segments.map((segment) => segment.text), [
        "Introduction",
        "First paragraph.",
        "Study aims",
        "Second paragraph.",
    ]);
    const sections = buildReadingSections(segments);
    assert.deepEqual(sections.map((section) => section.title), ["Introduction", "Study aims"]);
    assert.deepEqual(sections.map((section) => section.endIndex), [1, 3]);
    assert.equal(findCurrentSectionIndex(sections, 3), 1);
});

test("table narration uses marked headers and supplies row context", () => {
    const segments = buildReadingSegments([{
        type: "table",
        caption: "Examination results",
        header_rows: 1,
        rows: [
            ["Student", "Score"],
            ["Ada", "82"],
            ["Tunde", "91"],
        ],
    }]);
    assert.equal(segments[0].kind, "table-intro");
    assert.match(segments[0].text, /Column headings: Student; Score/);
    assert.equal(segments[1].text, "Row 1. Student: Ada. Score: 82.");
    assert.equal(segments[2].text, "Row 2. Student: Tunde. Score: 91.");
    assert.equal(segments[1].tableNumber, segments[2].tableNumber);
});

test("tables without marked headers do not guess the first row is a header", () => {
    const segments = buildReadingSegments([{
        type: "table",
        caption: "Unmarked data",
        header_rows: 0,
        rows: [
            ["Label A", "Value A"],
            ["Label B", "Value B"],
        ],
    }]);
    assert.match(segments[0].text, /without marked column headings/);
    assert.equal(segments[1].text, "Row 1. Column 1: Label A. Column 2: Value A.");
    assert.equal(segments[2].text, "Row 2. Column 1: Label B. Column 2: Value B.");
});

test("merged table cells are not repeated in the same row", () => {
    const segments = buildReadingSegments([{
        type: "table",
        caption: "Merged cells",
        header_rows: 0,
        rows: [["Combined", "", "Other"]],
        cell_spans: [[null, { covered_by: [0, 0] }, null]],
    }]);
    assert.equal(segments[1].text, "Row 1. Column 1: Combined. Column 3: Other.");
});

test("fallback text is split into readable paragraph segments", () => {
    const segments = buildReadingSegments([], "First paragraph.\n\nSecond paragraph.");
    assert.deepEqual(segments.map((segment) => segment.text), [
        "First paragraph.",
        "Second paragraph.",
    ]);
});

test("segment target map distinguishes document blocks and table rows", () => {
    const segments = buildReadingSegments([
        { type: "paragraph", text: "Opening." },
        { type: "table", caption: "Scores", header_rows: 1, rows: [["Name", "Score"], ["Ada", "90"]] },
    ]);
    const map = buildSegmentTargetMap(segments);
    assert.equal(map["0:"], 0);
    assert.equal(map["1:-1"], 1);
    assert.equal(map["1:1"], 2);
});


test("document-reading commands are recognised without treating summaries as read-aloud requests", () => {
    for (const command of [
        "Read this document aloud for me",
        "Could you read the contents of this document?",
        "Please read my lecture notes",
        "Read this PDF to me",
        "Read it aloud",
        "Continue reading",
        "Resume reading.",
    ]) {
        assert.equal(isDocumentReadCommand(command), true, command);
    }
    for (const command of [
        "Summarize this document",
        "Explain this PDF",
        "What does this document say?",
        "Open my resources",
    ]) {
        assert.equal(isDocumentReadCommand(command), false, command);
    }
});
