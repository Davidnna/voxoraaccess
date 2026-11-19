import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    buildReadingSections,
    buildReadingSegments,
    buildSegmentTargetMap,
    findCurrentSectionIndex,
} from "../data/reader.js";

function DocumentBlocks({ blocks, segmentTargets }) {
    const segmentIndex = (blockIndex, rowIndex = null) => {
        const key = `${blockIndex}:${rowIndex === null ? "" : rowIndex}`;
        return segmentTargets[key];
    };

    const buildListTree = (items) => {
        const roots = [];
        const stack = [{ level: -1, children: roots }];
        items.forEach((item) => {
            const requestedLevel = Math.max(0, Math.min(8, Number(item.level) || 0));
            const level = Math.min(requestedLevel, stack.length - 1);
            while (stack.length > level + 1) stack.pop();
            const node = { ...item, children: [] };
            stack[stack.length - 1].children.push(node);
            stack.push({ level, children: node.children });
        });
        return roots;
    };

    const renderListTree = (nodes, keyPrefix = "list") => {
        const groups = [];
        nodes.forEach((node) => {
            const ordered = Boolean(node.ordered);
            const last = groups[groups.length - 1];
            if (!last || last.ordered !== ordered) groups.push({ ordered, items: [node] });
            else last.items.push(node);
        });
        return groups.map((group, groupIndex) => {
            const List = group.ordered ? "ol" : "ul";
            return <List key={`${keyPrefix}-${groupIndex}`}>{group.items.map((item, itemIndex) => (
                <li
                    key={`${keyPrefix}-${groupIndex}-${itemIndex}`}
                    data-reader-segment-index={segmentIndex(item.blockIndex)}
                >
                    {item.text}
                    {item.children.length > 0 && renderListTree(item.children, `${keyPrefix}-${groupIndex}-${itemIndex}`)}
                </li>
            ))}</List>;
        });
    };

    const renderTableRow = (row, rowIndex, blockIndex, isHeader) => (
        <tr
            key={rowIndex}
            data-reader-segment-index={isHeader ? undefined : segmentIndex(blockIndex, rowIndex)}
        >
            {row.map((cell, cellIndex) => {
                const metadata = blocks[blockIndex]?.cell_spans?.[rowIndex]?.[cellIndex] || null;
                if (metadata?.covered_by) return null;
                const spans = {
                    colSpan: metadata?.colspan > 1 ? metadata.colspan : undefined,
                    rowSpan: metadata?.rowspan > 1 ? metadata.rowspan : undefined,
                };
                return isHeader
                    ? <th scope="col" key={cellIndex} {...spans}>{cell}</th>
                    : <td key={cellIndex} {...spans}>{cell}</td>;
            })}
        </tr>
    );

    const rendered = [];
    let index = 0;
    while (index < blocks.length) {
        const block = blocks[index] || {};
        if (block.type === "list_item") {
            const items = [];
            while (index < blocks.length && blocks[index]?.type === "list_item") {
                items.push({ ...blocks[index], blockIndex: index });
                index += 1;
            }
            rendered.push(
                <React.Fragment key={`list-${index}`}>
                    {renderListTree(buildListTree(items), `list-${index}`)}
                </React.Fragment>
            );
            continue;
        }
        if (block.type === "heading") {
            const level = Math.max(2, Math.min(6, Number(block.level) || 2));
            const Heading = `h${level}`;
            rendered.push(
                <Heading key={index} data-reader-segment-index={segmentIndex(index)}>
                    {block.text}
                </Heading>
            );
        } else if (block.type === "paragraph") {
            rendered.push(
                <p key={index} data-reader-segment-index={segmentIndex(index)}>{block.text}</p>
            );
        } else if (block.type === "image_description") {
            rendered.push(
                <p key={index} data-reader-segment-index={segmentIndex(index)}>
                    <strong>Image description:</strong> {block.text}
                </p>
            );
        } else if (block.type === "image_placeholder") {
            rendered.push(
                <p className="react-accessibility-note" key={index} data-reader-segment-index={segmentIndex(index)}>
                    {block.text}
                </p>
            );
        } else if (block.type === "speaker_notes") {
            rendered.push(
                <section className="react-speaker-notes" aria-label="Speaker notes" key={index} data-reader-segment-index={segmentIndex(index)}>
                    <h4>Speaker notes</h4><p>{block.text}</p>
                </section>
            );
        } else if (block.type === "table") {
            const rows = Array.isArray(block.rows) ? block.rows : [];
            const headerRows = Math.max(0, Math.min(rows.length, Number(block.header_rows) || 0));
            rendered.push(
                <div
                    className="react-reader-table-wrap"
                    key={index}
                    role="region"
                    tabIndex={0}
                    aria-label={`Scrollable table: ${block.caption || "Document table"}`}
                    data-reader-segment-index={segmentIndex(index, -1)}
                >
                    <table>
                        <caption>{block.caption || "Document table"}</caption>
                        {headerRows > 0 && (
                            <thead>
                                {rows.slice(0, headerRows).map((row, rowIndex) =>
                                    renderTableRow(row, rowIndex, index, true)
                                )}
                            </thead>
                        )}
                        <tbody>
                            {rows.slice(headerRows).map((row, offset) =>
                                renderTableRow(row, offset + headerRows, index, false)
                            )}
                        </tbody>
                    </table>
                </div>
            );
        }
        index += 1;
    }
    return <>{rendered}</>;
}

function normalizedName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export default function DocumentReader({
    resource,
    csrf,
    extracting,
    extractMessage,
    prepareAccessibleText,
    readerTextSize,
    setReaderTextSize,
}) {
    const resourceId = resource.id;
    const blocks = useMemo(() => {
        if (Array.isArray(resource.reading_blocks) && resource.reading_blocks.length) {
            return resource.reading_blocks;
        }
        return String(resource.reading_text || "")
            .split(/\n{2,}/)
            .map((text) => text.trim())
            .filter(Boolean)
            .map((text) => ({ type: "paragraph", text }));
    }, [resource.reading_blocks, resource.reading_text]);

    const segments = useMemo(
        () => buildReadingSegments(blocks),
        [blocks]
    );
    const sections = useMemo(
        () => buildReadingSections(segments),
        [segments]
    );
    const segmentTargets = useMemo(
        () => buildSegmentTargetMap(segments),
        [segments]
    );
    const fingerprint = resource.reading_fingerprint || "";
    const initialProgress = resource.reading_progress || {};
    const [progress, setProgress] = useState({
        next_segment_index: Number(initialProgress.next_segment_index) || 0,
        total_segments: segments.length,
        completed: Boolean(initialProgress.completed),
    });
    const [playbackIndex, setPlaybackIndex] = useState(
        Number(initialProgress.next_segment_index) || 0
    );
    const [reading, setReading] = useState(false);
    const [readerMessage, setReaderMessage] = useState("");
    const saveChainRef = useRef(Promise.resolve());
    const currentSectionIndex = findCurrentSectionIndex(
        sections,
        Math.min(playbackIndex, Math.max(0, segments.length - 1))
    );
    const currentSection = sections[currentSectionIndex] || null;

    useEffect(() => {
        const saved = resource.reading_progress || {};
        const nextIndex = Math.max(
            0,
            Math.min(segments.length, Number(saved.next_segment_index) || 0)
        );
        setProgress({
            next_segment_index: nextIndex,
            total_segments: segments.length,
            completed: Boolean(saved.completed && nextIndex >= segments.length),
        });
        setPlaybackIndex(Math.min(nextIndex, Math.max(0, segments.length - 1)));
        setReading(false);
        setReaderMessage("");
    }, [resourceId, fingerprint, segments.length]);

    useEffect(() => {
        const persistProgress = (detail) => {
            const nextIndex = Math.max(
                0,
                Math.min(segments.length, Number(detail.nextSegmentIndex) || 0)
            );
            const completed = Boolean(detail.completed && nextIndex >= segments.length);
            const reset = Boolean(detail.reset);
            setProgress({
                next_segment_index: nextIndex,
                total_segments: segments.length,
                completed,
            });
            setPlaybackIndex(Math.min(nextIndex, Math.max(0, segments.length - 1)));

            const payload = {
                next_segment_index: nextIndex,
                total_segments: segments.length,
                reading_fingerprint: fingerprint,
                completed,
                reset,
            };
            const save = () => fetch(`/api/resource/${resourceId}/reading-progress`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrf,
                    Accept: "application/json",
                },
                credentials: "same-origin",
                keepalive: true,
                body: JSON.stringify(payload),
            }).then(async (response) => {
                if (response.status === 409) {
                    setReaderMessage("This reading view has changed. Start again from the beginning.");
                    return;
                }
                if (!response.ok) {
                    throw new Error("Reading progress could not be saved.");
                }
            }).catch(() => {
                setReaderMessage("Your current place is available during this visit, but could not be saved to your account.");
            });
            saveChainRef.current = saveChainRef.current.catch(() => {}).then(save);
        };

        const onProgress = (event) => {
            const detail = event.detail || {};
            if (Number(detail.resourceId) !== Number(resourceId)) return;
            persistProgress(detail);
        };

        const onPosition = (event) => {
            const detail = event.detail || {};
            if (Number(detail.resourceId) !== Number(resourceId)) return;
            const index = Number(detail.index);
            if (!Number.isInteger(index) || index < 0 || index >= segments.length) return;
            setPlaybackIndex(index);
            const content = document.querySelector(".react-document-reading-content");
            content?.querySelectorAll('[aria-current="location"]').forEach((element) => {
                element.removeAttribute("aria-current");
                element.removeAttribute("data-reader-active");
            });
            const target = content?.querySelector(`[data-reader-segment-index="${index}"]`);
            if (target) {
                target.setAttribute("aria-current", "location");
                target.setAttribute("data-reader-active", "true");
                target.scrollIntoView({
                    behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                    block: "nearest",
                });
            }
        };

        const onComplete = (event) => {
            if (Number(event.detail?.resourceId) !== Number(resourceId)) return;
            setReading(false);
            setReaderMessage(event.detail?.documentComplete
                ? "You have reached the end of this document."
                : "This part is complete. Continue whenever you are ready.");
        };
        const onStopped = (event) => {
            if (Number(event.detail?.resourceId) !== Number(resourceId)) return;
            setReading(false);
            setReaderMessage("Reading paused. Continue whenever you are ready.");
        };
        const onError = (event) => {
            if (Number(event.detail?.resourceId) !== Number(resourceId)) return;
            setReading(false);
            setReaderMessage("Reading could not continue. Try again from your saved place.");
        };

        window.addEventListener("voxora:reader-progress", onProgress);
        window.addEventListener("voxora:reader-position", onPosition);
        window.addEventListener("voxora:reader-complete", onComplete);
        window.addEventListener("voxora:reader-stopped", onStopped);
        window.addEventListener("voxora:reader-error", onError);
        return () => {
            window.removeEventListener("voxora:reader-progress", onProgress);
            window.removeEventListener("voxora:reader-position", onPosition);
            window.removeEventListener("voxora:reader-complete", onComplete);
            window.removeEventListener("voxora:reader-stopped", onStopped);
            window.removeEventListener("voxora:reader-error", onError);
        };
    }, [resourceId, csrf, fingerprint, segments.length]);

    const dispatchProgress = (nextSegmentIndex, reset = false) => {
        window.dispatchEvent(new CustomEvent("voxora:reader-progress", {
            detail: {
                resourceId,
                nextSegmentIndex,
                totalSegments: segments.length,
                completed: nextSegmentIndex >= segments.length && segments.length > 0,
                reset,
            },
        }));
    };

    const startAt = (requestedIndex, { reset = false, endIndex = segments.length - 1 } = {}) => {
        if (!segments.length) {
            setReaderMessage("There is no readable content in this document.");
            return;
        }
        const startIndex = Math.max(0, Math.min(segments.length - 1, Number(requestedIndex) || 0));
        const boundedEndIndex = Math.max(startIndex, Math.min(segments.length - 1, Number(endIndex) || 0));
        setReading(true);
        setReaderMessage("");
        if (reset || startIndex !== progress.next_segment_index) {
            dispatchProgress(startIndex, true);
        }
        window.dispatchEvent(new CustomEvent("voxora:read-segments", {
            detail: {
                resourceId,
                readingFingerprint: fingerprint,
                segments,
                startIndex,
                endIndex: boundedEndIndex,
            },
        }));
    };

    const currentIndex = reading
        ? playbackIndex
        : Math.min(progress.next_segment_index, Math.max(0, segments.length - 1));
    const activeSectionIndex = findCurrentSectionIndex(sections, currentIndex);

    const handleReaderCommand = (command, sectionTitle = "") => {
        if (!segments.length) {
            setReaderMessage("There is no readable content in this document.");
            return;
        }
        const sectionIndex = findCurrentSectionIndex(sections, currentIndex);
        if (command === "resume") {
            const start = progress.completed ? 0 : progress.next_segment_index;
            startAt(start, { reset: Boolean(progress.completed) });
        } else if (command === "restart") {
            startAt(0, { reset: true });
        } else if (command === "current-section") {
            const section = sections[Math.max(0, sectionIndex)];
            if (section) startAt(section.startIndex, { endIndex: section.endIndex });
        } else if (command === "next-section" || command === "previous-section") {
            const nextSectionIndex = sectionIndex + (command === "next-section" ? 1 : -1);
            const section = sections[nextSectionIndex];
            if (!section) {
                setReaderMessage(command === "next-section"
                    ? "You are already at the last section."
                    : "You are already at the first section.");
                return;
            }
            startAt(section.startIndex, { endIndex: section.endIndex });
        } else if (command === "go-to-section") {
            const wanted = normalizedName(sectionTitle);
            const section = sections.find((item) =>
                normalizedName(item.title).includes(wanted) || wanted.includes(normalizedName(item.title))
            );
            if (!section) {
                setReaderMessage(`I could not find a section called ${sectionTitle}.`);
                return;
            }
            startAt(section.startIndex, { endIndex: section.endIndex });
        } else if (command === "next-table" || command === "current-table") {
            const tables = segments
                .map((segment, index) => ({ segment, index }))
                .filter((item) => item.segment.kind === "table-intro");
            const table = command === "next-table"
                ? tables.find((item) => item.index > currentIndex)
                : [...tables].reverse().find((item) => item.index <= currentIndex) || tables.find((item) => item.index >= currentIndex);
            if (!table) {
                setReaderMessage("There is no table available at this place in the document.");
                return;
            }
            const tableEndIndex = segments.reduce(
                (lastIndex, segment, index) => segment.tableNumber === table.segment.tableNumber ? index : lastIndex,
                table.index
            );
            startAt(table.index, { endIndex: tableEndIndex });
        }
    };

    useEffect(() => {
        const onCommand = (event) => {
            const detail = event.detail || {};
            handleReaderCommand(detail.command, detail.sectionTitle || "");
        };
        window.addEventListener("voxora:reader-command", onCommand);
        return () => window.removeEventListener("voxora:reader-command", onCommand);
    }, [resourceId, fingerprint, segments, sections, progress, playbackIndex, reading]);

    const stopReading = () => {
        window.dispatchEvent(new Event("voxora:stop-reading"));
    };
    const hasText = segments.length > 0;
    const statusLabel = {
        ready: "Reading view ready",
        partial: "Reading view has limitations",
        needs_ocr: "Text recognition needed",
        failed: "Reading view unavailable",
        pending: "Reading view not prepared",
    }[resource.extraction_status] || "Reading view status unavailable";

    return (
        <>
            <p><a href={`/resource/${resource.id}`}>Back to resource</a></p>
            <p className="react-eyebrow">ACCESSIBLE READING VIEW</p>
            <h1>{resource.title}</h1>
            <p className="react-reader-intro">
                Move through the document by section, listen in order, and return to your saved place.
            </p>

            <div className="react-reader-toolbar" role="group" aria-label="Document reading controls">
                <button
                    type="button"
                    className="react-primary-button"
                    disabled={!hasText}
                    onClick={() => handleReaderCommand("resume")}
                >
                    {progress.next_segment_index > 0 && !progress.completed ? "Continue reading" : "Read document"}
                </button>
                <button
                    type="button"
                    className="react-secondary-button"
                    disabled={!hasText}
                    onClick={() => handleReaderCommand("restart")}
                >
                    Start from beginning
                </button>
                <button
                    type="button"
                    className="react-secondary-button"
                    disabled={!sections.length || activeSectionIndex <= 0}
                    onClick={() => handleReaderCommand("previous-section")}
                >
                    Previous section
                </button>
                <button
                    type="button"
                    className="react-secondary-button"
                    disabled={!sections.length || activeSectionIndex < 0 || activeSectionIndex >= sections.length - 1}
                    onClick={() => handleReaderCommand("next-section")}
                >
                    Next section
                </button>
                <button
                    type="button"
                    className="react-secondary-button"
                    disabled={!sections.length}
                    onClick={() => handleReaderCommand("current-section")}
                >
                    Read this section
                </button>
                <button
                    type="button"
                    className="react-secondary-button"
                    disabled={!reading}
                    onClick={stopReading}
                >
                    Stop reading
                </button>
                <label htmlFor="reader-section-select">Go to section</label>
                <select
                    id="reader-section-select"
                    value={activeSectionIndex >= 0 ? String(activeSectionIndex) : ""}
                    onChange={(event) => {
                        const selected = sections[Number(event.target.value)];
                        if (selected) startAt(selected.startIndex, { endIndex: selected.endIndex });
                    }}
                    disabled={!sections.length}
                >
                    {sections.map((section, index) => (
                        <option value={index} key={`${section.startIndex}-${section.title}`}>
                            {section.title}
                        </option>
                    ))}
                </select>
                <label htmlFor="reader-text-size">Text size</label>
                <input
                    id="reader-text-size"
                    type="range"
                    min="100"
                    max="180"
                    step="10"
                    value={readerTextSize}
                    onChange={(event) => setReaderTextSize(Number(event.target.value))}
                    aria-valuetext={`${readerTextSize} percent`}
                />
                <output htmlFor="reader-text-size">{readerTextSize}%</output>
                <a href={`/resource/${resource.id}/download`}>Download original</a>
            </div>

            <p className="react-reader-progress" role="status" aria-live="polite">
                {readerMessage || (currentSection
                    ? `Your place: ${currentSection.title}${progress.completed ? " · Document completed" : ""}`
                    : "Your reading place will appear here.")}
            </p>

            <section
                className={`react-extraction-status status-${resource.extraction_status || "pending"}`}
                aria-labelledby="extraction-status-title"
            >
                <h2 id="extraction-status-title">{statusLabel}</h2>
                {resource.page_count && <p>Pages or slides processed: {resource.page_count}</p>}
                {resource.extraction_warnings?.length > 0 && (
                    <>
                        <h3>Document notes</h3>
                        <ul>{resource.extraction_warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                    </>
                )}
                {hasText && resource.is_owner && (
                    <button
                        type="button"
                        className="react-secondary-button"
                        disabled={extracting}
                        onClick={() => prepareAccessibleText(resource.id)}
                    >
                        {extracting ? "Preparing reading view…" : "Refresh reading view"}
                    </button>
                )}
            </section>
            {extractMessage && <p className="react-extraction-message" role="status" aria-live="polite">{extractMessage}</p>}
            {!hasText && (
                <section className="react-document-fallback">
                    <h2>A reading view is not available yet</h2>
                    <p>The original document is still available. The owner can try preparing the reading view again.</p>
                    {resource.is_owner && (
                        <button
                            type="button"
                            className="react-primary-button"
                            disabled={extracting}
                            onClick={() => prepareAccessibleText(resource.id)}
                        >
                            {extracting ? "Preparing reading view…" : "Prepare reading view"}
                        </button>
                    )}
                    <a href={`/resource/${resource.id}/download`}>Download original document</a>
                </section>
            )}
            {hasText && (
                <article
                    className="react-document-reading-content"
                    aria-labelledby="document-reading-title"
                    style={{ "--reader-text-size": `${readerTextSize}%` }}
                >
                    <h2 id="document-reading-title">Document content</h2>
                    <DocumentBlocks blocks={blocks} segmentTargets={segmentTargets}/>
                </article>
            )}
            {(resource.reading_truncated || resource.extraction_truncated) && (
                <p className="react-accessibility-note">
                    Only part of this document is available in the reading view. Download the original to access the complete document.
                </p>
            )}
            <p className="react-accessibility-note">
                Scanned text, diagrams, equations, charts and complex layouts may not be represented accurately. Check important information against the original document.
            </p>
        </>
    );
}
