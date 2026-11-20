export function isDocumentReadCommand(value) {
    const command = String(value ?? "").toLowerCase().replace(/[.!?]+$/, "").trim();
    return /^(?:(?:please|can you|could you|would you) )?(?:(?:read|speak)(?: out)? (?:the )?(?:(?:contents? of )?(?:this|the|current|my) )?(?:uploaded )?(?:document|resource|file|pdf|(?:lecture )?notes)(?: out loud for me| aloud for me| out loud| aloud| to me| for me)?|read it(?: aloud for me| out loud| aloud| to me| for me)?|start reading|continue reading|resume reading)$/i.test(command);
}

const READABLE_BLOCK_TYPES = new Set([
    "heading",
    "paragraph",
    "list_item",
    "image_description",
    "image_placeholder",
    "speaker_notes",
]);

function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cellValue(rows, spans, rowIndex, columnIndex) {
    const metadata = spans?.[rowIndex]?.[columnIndex];
    if (metadata?.covered_by && Array.isArray(metadata.covered_by)) {
        const [sourceRow, sourceColumn] = metadata.covered_by;
        return cleanText(rows?.[sourceRow]?.[sourceColumn]);
    }
    return cleanText(rows?.[rowIndex]?.[columnIndex]);
}

function tableHeaderLabels(block, width) {
    const rows = Array.isArray(block.rows) ? block.rows : [];
    const spans = Array.isArray(block.cell_spans) ? block.cell_spans : [];
    const headerRows = Math.max(0, Math.min(rows.length, Number(block.header_rows) || 0));

    return Array.from({ length: width }, (_, columnIndex) => {
        const labels = [];
        for (let rowIndex = 0; rowIndex < headerRows; rowIndex += 1) {
            const label = cellValue(rows, spans, rowIndex, columnIndex);
            if (label && labels[labels.length - 1] !== label) labels.push(label);
        }
        return labels.length ? labels.join(" — ") : `Column ${columnIndex + 1}`;
    });
}

function tableSegments(block, blockIndex, tableNumber, sectionTitle) {
    const rows = Array.isArray(block.rows) ? block.rows : [];
    const width = rows.reduce((largest, row) => Math.max(largest, Array.isArray(row) ? row.length : 0), 0);
    if (!rows.length || !width) return [];

    const spans = Array.isArray(block.cell_spans) ? block.cell_spans : [];
    const headerRows = Math.max(0, Math.min(rows.length, Number(block.header_rows) || 0));
    const headers = tableHeaderLabels(block, width);
    const caption = cleanText(block.caption) || `Table ${tableNumber}`;
    const columnHeadingText = headerRows
        ? `Column headings: ${headers.join("; ")}.`
        : `This table has ${width} columns without marked column headings.`;
    const segments = [{
        kind: "table-intro",
        text: `${caption}. ${columnHeadingText}`,
        blockIndex,
        rowIndex: -1,
        tableNumber,
        sectionTitle,
    }];

    let dataRowNumber = 0;
    for (let rowIndex = headerRows; rowIndex < rows.length; rowIndex += 1) {
        const values = [];
        const seenMergedCells = new Set();
        for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
            const metadata = spans?.[rowIndex]?.[columnIndex];
            const source = metadata?.covered_by;
            const sourceKey = Array.isArray(source) ? source.join(":") : `${rowIndex}:${columnIndex}`;
            if (seenMergedCells.has(sourceKey)) continue;
            seenMergedCells.add(sourceKey);

            const value = cellValue(rows, spans, rowIndex, columnIndex);
            if (!value) continue;
            const label = headers[columnIndex] || `Column ${columnIndex + 1}`;
            values.push(`${label}: ${value}`);
        }
        if (!values.length) continue;
        dataRowNumber += 1;
        segments.push({
            kind: "table-row",
            text: `Row ${dataRowNumber}. ${values.join(". ")}.`,
            blockIndex,
            rowIndex,
            tableNumber,
            tableRowNumber: dataRowNumber,
            sectionTitle,
        });
    }
    return segments;
}

export function buildReadingSegments(blocks, fallbackText = "") {
    const sourceBlocks = Array.isArray(blocks) && blocks.length
        ? blocks
        : String(fallbackText || "")
            .split(/\n{2,}/)
            .map((text) => ({ type: "paragraph", text: cleanText(text) }))
            .filter((block) => block.text);

    const segments = [];
    let sectionTitle = "Document introduction";
    let tableNumber = 0;

    sourceBlocks.forEach((block, blockIndex) => {
        if (!block || typeof block !== "object") return;
        const kind = String(block.type || "");
        if (kind === "page_break" || kind === "slide_break") return;

        if (kind === "heading") {
            const text = cleanText(block.text);
            if (!text) return;
            sectionTitle = text;
            segments.push({
                kind: "heading",
                text,
                blockIndex,
                rowIndex: null,
                headingLevel: Math.max(2, Math.min(6, Number(block.level) || 2)),
                sectionTitle,
            });
            return;
        }

        if (kind === "table") {
            tableNumber += 1;
            segments.push(...tableSegments(block, blockIndex, tableNumber, sectionTitle));
            return;
        }

        if (!READABLE_BLOCK_TYPES.has(kind)) return;
        const text = cleanText(block.text);
        if (!text) return;

        let spokenText = text;
        if (kind === "image_description") spokenText = `Image description. ${text}`;
        else if (kind === "image_placeholder") spokenText = `Image note. ${text}`;
        else if (kind === "speaker_notes") spokenText = `Speaker notes. ${text}`;
        else if (kind === "list_item") spokenText = `List item. ${text}`;

        segments.push({
            kind,
            text: spokenText,
            blockIndex,
            rowIndex: null,
            sectionTitle,
            ordered: Boolean(block.ordered),
            level: Math.max(0, Math.min(8, Number(block.level) || 0)),
        });
    });

    return segments;
}

export function buildReadingSections(segments) {
    if (!Array.isArray(segments) || !segments.length) return [];
    const headings = [];
    segments.forEach((segment, index) => {
        if (segment.kind === "heading") {
            headings.push({
                title: cleanText(segment.text),
                level: segment.headingLevel || 2,
                startIndex: index,
            });
        }
    });

    const sections = [];
    if (!headings.length || headings[0].startIndex > 0) {
        sections.push({
            title: "Introduction",
            level: 2,
            startIndex: 0,
        });
    }
    sections.push(...headings);

    return sections.map((section, index) => ({
        ...section,
        endIndex: (sections[index + 1]?.startIndex ?? segments.length) - 1,
    }));
}

export function findCurrentSectionIndex(sections, segmentIndex) {
    if (!Array.isArray(sections) || !sections.length) return -1;
    const target = Math.max(0, Number(segmentIndex) || 0);
    let found = 0;
    sections.forEach((section, index) => {
        if (section.startIndex <= target) found = index;
    });
    return found;
}

export function buildSegmentTargetMap(segments) {
    const targets = {};
    (Array.isArray(segments) ? segments : []).forEach((segment, index) => {
        const key = `${segment.blockIndex}:${segment.rowIndex === null || segment.rowIndex === undefined ? "" : segment.rowIndex}`;
        if (!(key in targets)) targets[key] = index;
    });
    return targets;
}
