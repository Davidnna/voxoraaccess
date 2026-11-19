"""Bounded document text extraction for Voxora's accessible reading view.

This module creates a semantic, text-first representation of supported uploads.
It does not rewrite or certify the original file as an accessible PDF.
"""

from __future__ import annotations

import csv
import io
import xml.etree.ElementTree as ET
import os
import re
import shutil
import zipfile
from typing import Any

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph
from pptx import Presentation
from pypdf import PdfReader

MAX_EXTRACTED_TEXT_CHARS = max(
    10_000, int(os.environ.get("VOXORA_MAX_EXTRACTED_TEXT_CHARS", "200000"))
)
MAX_DOCUMENT_PAGES = max(1, int(os.environ.get("VOXORA_MAX_DOCUMENT_PAGES", "250")))
MAX_OCR_PAGES = max(0, int(os.environ.get("VOXORA_MAX_OCR_PAGES", "6")))
OCR_LANG = os.environ.get("VOXORA_OCR_LANG", "eng").strip() or "eng"
OCR_TIMEOUT_SECONDS = max(3, int(os.environ.get("VOXORA_OCR_TIMEOUT_SECONDS", "5")))
MAX_TABLE_ROWS = 1000
MAX_TABLE_COLUMNS = 40


def _clean_text(value: Any) -> str:
    text = str(value or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(line.rstrip() for line in text.splitlines())
    return text.strip()


def _paragraph_blocks(text: str) -> list[dict[str, Any]]:
    blocks = []
    for paragraph in re.split(r"\n\s*\n", _clean_text(text)):
        paragraph = paragraph.strip()
        if paragraph:
            blocks.append({"type": "paragraph", "text": paragraph})
    return blocks


def _table_block(
    rows: list[list[str]],
    caption: str,
    header_rows: int = 0,
    cell_spans: list[list[dict[str, Any] | None]] | None = None,
) -> dict[str, Any] | None:
    """Create a bounded table block without inventing header semantics.

    ``cell_spans`` maps merged grid positions to their originating cell so the
    reader can render Word/PowerPoint merged cells without duplicating content.
    """
    rows_truncated = len(rows) > MAX_TABLE_ROWS
    columns_truncated = any(len(row) > MAX_TABLE_COLUMNS for row in rows)
    clean_rows: list[list[str]] = []
    clean_spans: list[list[dict[str, Any] | None]] = []
    for row_index, row in enumerate(rows[:MAX_TABLE_ROWS]):
        clean = [_clean_text(cell) for cell in row[:MAX_TABLE_COLUMNS]]
        source_spans = cell_spans[row_index] if cell_spans and row_index < len(cell_spans) else []
        spans = [dict(meta) if meta else None for meta in source_spans[:MAX_TABLE_COLUMNS]]
        if any(clean) or any(spans):
            clean_rows.append(clean)
            clean_spans.append(spans)
    if not clean_rows:
        return None
    width = min(MAX_TABLE_COLUMNS, max(len(row) for row in clean_rows))
    clean_rows = [row[:width] + [""] * (width - len(row)) for row in clean_rows]
    block = {
        "type": "table",
        "caption": _clean_text(caption),
        "rows": clean_rows,
        "header_rows": max(0, min(len(clean_rows), int(header_rows or 0))),
        "truncated_rows": rows_truncated,
        "truncated_columns": columns_truncated,
    }
    if cell_spans and any(any(meta for meta in row) for row in clean_spans):
        block["cell_spans"] = [
            (row + [None] * (width - len(row)))[:width]
            for row in clean_spans
        ]
    return block


def _docx_heading_level(paragraph: Paragraph) -> int | None:
    """Return a heading level only when Word style/outline metadata supports it."""
    p_pr = paragraph._p.pPr
    if p_pr is not None:
        outline = p_pr.find(qn("w:outlineLvl"))
        if outline is not None:
            try:
                return max(2, min(6, int(outline.get(qn("w:val"), "0")) + 2))
            except (TypeError, ValueError):
                pass

    style = paragraph.style
    visited: set[str] = set()
    while style is not None:
        style_id = str(getattr(style, "style_id", "") or "")
        style_name = str(getattr(style, "name", "") or "").strip()
        if style_id in visited:
            break
        visited.add(style_id)
        match = re.search(r"heading\s*(\d+)$", style_name, re.I) or re.search(r"heading(\d+)$", style_id, re.I)
        if match:
            return max(2, min(6, int(match.group(1)) + 1))
        if style_name.lower() == "title" or style_id.lower() == "title":
            return 2
        style_element = getattr(style, "_element", None)
        style_ppr = style_element.pPr if style_element is not None else None
        if style_ppr is not None:
            outline = style_ppr.find(qn("w:outlineLvl"))
            if outline is not None:
                try:
                    return max(2, min(6, int(outline.get(qn("w:val"), "0")) + 2))
                except (TypeError, ValueError):
                    pass
        style = getattr(style, "base_style", None)
    return None


def _docx_numbering_formats(document) -> dict[tuple[str, int], str]:
    """Map Word numbering IDs and levels to their declared numbering format."""
    formats: dict[tuple[str, int], str] = {}
    try:
        numbering = document.part.numbering_part.element
        abstract_formats: dict[str, dict[int, str]] = {}
        for abstract in numbering.findall(qn("w:abstractNum")):
            abstract_id = abstract.get(qn("w:abstractNumId"), "")
            levels: dict[int, str] = {}
            for level in abstract.findall(qn("w:lvl")):
                try:
                    level_index = int(level.get(qn("w:ilvl"), "0"))
                except ValueError:
                    continue
                num_fmt = level.find(qn("w:numFmt"))
                if num_fmt is not None:
                    levels[level_index] = num_fmt.get(qn("w:val"), "")
            abstract_formats[abstract_id] = levels

        for num in numbering.findall(qn("w:num")):
            num_id = num.get(qn("w:numId"), "")
            abstract_ref = num.find(qn("w:abstractNumId"))
            if abstract_ref is None:
                continue
            abstract_id = abstract_ref.get(qn("w:val"), "")
            levels = dict(abstract_formats.get(abstract_id, {}))
            for override in num.findall(qn("w:lvlOverride")):
                try:
                    level_index = int(override.get(qn("w:ilvl"), "0"))
                except ValueError:
                    continue
                level = override.find(qn("w:lvl"))
                num_fmt = level.find(qn("w:numFmt")) if level is not None else None
                if num_fmt is not None:
                    levels[level_index] = num_fmt.get(qn("w:val"), "")
            for level_index, num_fmt in levels.items():
                formats[(num_id, level_index)] = num_fmt
    except Exception:
        return {}
    return formats


def _docx_list_info(paragraph: Paragraph, numbering_formats: dict[tuple[str, int], str]) -> dict[str, Any] | None:
    """Detect explicit Word list numbering and retain nesting level."""
    p_pr = paragraph._p.pPr
    if p_pr is not None:
        num_pr = p_pr.find(qn("w:numPr"))
        if num_pr is not None:
            num_id_node = num_pr.find(qn("w:numId"))
            level_node = num_pr.find(qn("w:ilvl"))
            num_id = num_id_node.get(qn("w:val"), "") if num_id_node is not None else ""
            try:
                level = int(level_node.get(qn("w:val"), "0")) if level_node is not None else 0
            except ValueError:
                level = 0
            number_format = numbering_formats.get((num_id, level), "")
            if number_format:
                return {"ordered": number_format.lower() != "bullet", "level": max(0, min(8, level))}

    style = paragraph.style
    visited: set[str] = set()
    while style is not None:
        style_id = str(getattr(style, "style_id", "") or "")
        style_name = str(getattr(style, "name", "") or "")
        if style_id in visited:
            break
        visited.add(style_id)
        match = re.search(r"list\s*(bullet|number)(?:\s*(\d+))?", style_name, re.I) or re.search(r"list(bullet|number)(\d*)", style_id, re.I)
        if match:
            kind = match.group(1).lower()
            try:
                level = max(0, int(match.group(2) or "1") - 1)
            except ValueError:
                level = 0
            return {"ordered": kind == "number", "level": min(8, level)}
        style = getattr(style, "base_style", None)
    return None


def _docx_inline_blocks(paragraph: Paragraph) -> tuple[list[dict[str, Any]], int, int, list[str]]:
    """Preserve the sequence of text and visual objects inside a Word paragraph."""
    blocks: list[dict[str, Any]] = []
    warnings: list[str] = []
    text_parts: list[str] = []
    image_count = 0
    image_alt_count = 0

    def flush_text() -> None:
        value = _clean_text("".join(text_parts))
        if value:
            blocks.append({"type": "paragraph", "text": value})
        text_parts.clear()

    for node in paragraph._p.iter():
        if node.tag == qn("w:t"):
            text_parts.append(node.text or "")
        elif node.tag == qn("w:tab"):
            text_parts.append("\t")
        elif node.tag in {qn("w:br"), qn("w:cr")}:
            text_parts.append("\n")
        elif node.tag.endswith("}docPr"):
            flush_text()
            image_count += 1
            alt = _clean_text(node.get("descr") or node.get("title"))
            if alt:
                image_alt_count += 1
                blocks.append({"type": "image_description", "text": alt})
            else:
                warnings.append("A visual object in the Word document has no alternative description in the source document.")
                blocks.append({"type": "image_placeholder", "text": "Visual object without an alternative description."})
    flush_text()
    return blocks, image_count, image_alt_count, warnings


def _docx_table_grid(table: Table) -> tuple[list[list[str]], list[list[dict[str, Any] | None]], bool, int, list[str]]:
    """Read Word table grid cells and preserve horizontal/vertical merge geometry."""
    warnings: list[str] = []
    physical_rows: list[list[dict[str, Any]]] = []
    grid_width = len(table.columns)
    merged = False

    for row in table.rows:
        cells: list[dict[str, Any]] = []
        column = 0
        for tc in row._tr.tc_lst:
            tc_pr = tc.tcPr
            span_node = tc_pr.gridSpan if tc_pr is not None else None
            try:
                colspan = max(1, int(span_node.val)) if span_node is not None else 1
            except (TypeError, ValueError):
                colspan = 1
            merge_node = tc_pr.vMerge if tc_pr is not None else None
            merge_state = None
            if merge_node is not None:
                merge_state = "restart" if (merge_node.val or "continue") == "restart" else "continue"
            cell = _Cell(tc, table)
            cells.append({"column": column, "colspan": colspan, "merge": merge_state, "text": _clean_text(cell.text)})
            column += colspan
            merged = merged or colspan > 1 or merge_state is not None
            if tc.xpath(".//w:tbl"):
                warnings.append("A table is nested inside another table. Some inner content may not appear in the reading view.")
        grid_width = max(grid_width, column)
        physical_rows.append(cells)

    rows = [[""] * grid_width for _ in physical_rows]
    spans: list[list[dict[str, Any] | None]] = [[None] * grid_width for _ in physical_rows]
    active_merges: dict[int, tuple[int, int]] = {}
    for row_index, cells in enumerate(physical_rows):
        next_active: dict[int, tuple[int, int]] = {}
        for cell in cells:
            column = cell["column"]
            colspan = cell["colspan"]
            merge_state = cell["merge"]
            if merge_state == "continue":
                source = active_merges.get(column)
                if source and source[1] == colspan:
                    spans[row_index][column] = {"covered_by": [source[0], column], "colspan": colspan}
                    for offset in range(1, colspan):
                        spans[row_index][column + offset] = {"covered_by": [source[0], column]}
                    next_active[column] = source
                else:
                    warnings.append("A merged table cell could not be matched reliably. Check this table in the original document.")
                    rows[row_index][column] = cell["text"]
            else:
                rows[row_index][column] = cell["text"]
                rowspan = 1
                if merge_state == "restart":
                    for later_row in physical_rows[row_index + 1:]:
                        continuation = next((candidate for candidate in later_row if candidate["column"] == column), None)
                        if continuation is None or continuation["merge"] != "continue" or continuation["colspan"] != colspan:
                            break
                        rowspan += 1
                    next_active[column] = (row_index, colspan)
                if colspan > 1 or rowspan > 1:
                    spans[row_index][column] = {"colspan": colspan, "rowspan": rowspan}
                    for offset in range(1, colspan):
                        spans[row_index][column + offset] = {"covered_by": [row_index, column]}
        active_merges = next_active

    header_rows = 0
    header_ended = False
    for row_index, row in enumerate(table.rows):
        tr_pr = row._tr.trPr
        marker = tr_pr.find(qn("w:tblHeader")) if tr_pr is not None else None
        is_header = marker is not None and str(marker.get(qn("w:val"), "true")).lower() not in {"0", "false", "off"}
        if is_header and not header_ended and row_index == header_rows:
            header_rows += 1
        elif is_header:
            warnings.append("A table marks a later row as a repeating heading. Only consecutive heading rows at the top are applied; check the original table.")
            header_ended = True
        elif header_rows:
            header_ended = True

    return rows, spans, merged, header_rows, warnings


def _extract_word_notes(archive: zipfile.ZipFile, part_name: str, note_tag: str) -> list[str]:
    if part_name not in archive.namelist():
        return []
    try:
        root = ET.fromstring(archive.read(part_name))
    except ET.ParseError:
        return []
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    notes = []
    for note in root.findall(f"{namespace}{note_tag}"):
        note_id = note.get(f"{namespace}id", "")
        note_type = note.get(f"{namespace}type", "")
        if note_type in {"separator", "continuationSeparator", "continuationNotice"} or note_id in {"0", "1", "-1"}:
            continue
        paragraphs = []
        for paragraph in note.findall(f"{namespace}p"):
            text = "".join(node.text or "" for node in paragraph.iter(f"{namespace}t"))
            text = _clean_text(text)
            if text:
                paragraphs.append(text)
        if paragraphs:
            notes.append(f"Note {note_id}: " + " ".join(paragraphs))
    return notes


def _markdown_blocks(text: str) -> list[dict[str, Any]]:
    lines = _clean_text(text).splitlines()
    blocks: list[dict[str, Any]] = []
    paragraph: list[str] = []
    index = 0

    def flush_paragraph() -> None:
        value = " ".join(part.strip() for part in paragraph if part.strip()).strip()
        if value:
            blocks.append({"type": "paragraph", "text": value})
        paragraph.clear()

    while index < len(lines):
        line = lines[index].strip()
        if not line:
            flush_paragraph()
            index += 1
            continue

        heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if heading:
            flush_paragraph()
            blocks.append({
                "type": "heading",
                "level": min(6, len(heading.group(1)) + 1),
                "text": heading.group(2).strip(),
            })
            index += 1
            continue

        if line.startswith("|") and index + 1 < len(lines) and re.match(
            r"^\s*\|?\s*:?-{3,}", lines[index + 1]
        ):
            flush_paragraph()
            raw_rows = [line]
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                raw_rows.append(lines[index].strip())
                index += 1
            rows = [
                [cell.strip() for cell in row.strip("|").split("|")]
                for row in raw_rows
            ]
            table = _table_block(rows, "Document table", header_rows=1)
            if table:
                blocks.append(table)
            continue

        list_match = re.match(r"^\s*((?:[-*+])|(?:\d+[.)]))\s+(.+)$", line)
        if list_match:
            flush_paragraph()
            marker = list_match.group(1)
            blocks.append({
                "type": "list_item",
                "ordered": marker[0].isdigit(),
                "text": list_match.group(2).strip(),
            })
            index += 1
            continue

        paragraph.append(line)
        index += 1

    flush_paragraph()
    return blocks


def _csv_blocks(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    sample = _clean_text(text)
    if not sample:
        return [], warnings
    try:
        dialect = csv.Sniffer().sniff(sample[:8192], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = []
    for row in csv.reader(io.StringIO(sample), dialect):
        rows.append(row)
        if len(rows) > MAX_TABLE_ROWS:
            break
    if not rows:
        return [], warnings
    if len(rows) > MAX_TABLE_ROWS:
        rows = rows[:MAX_TABLE_ROWS]
        warnings.append(f"Only the first {MAX_TABLE_ROWS} rows are available in the accessible table.")
    warnings.append("The first row may contain column headings, but this file does not identify them. All rows are presented as data; check the original table before relying on column labels.")
    if any(len(row) > MAX_TABLE_COLUMNS for row in rows):
        rows = [row[:MAX_TABLE_COLUMNS] for row in rows]
        warnings.append(f"Only the first {MAX_TABLE_COLUMNS} columns are available in the accessible table.")
    table = _table_block(rows, "CSV data", header_rows=0)
    return ([table] if table else []), warnings


def _docx_blocks(file_data: bytes) -> tuple[list[dict[str, Any]], list[str], int | None]:
    document = Document(io.BytesIO(file_data))
    blocks: list[dict[str, Any]] = []
    warnings: list[str] = []
    table_index = 0
    image_count = 0
    image_alt_count = 0
    numbering_formats = _docx_numbering_formats(document)

    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            paragraph = Paragraph(child, document)
            inline_blocks, found_images, described_images, inline_warnings = _docx_inline_blocks(paragraph)
            image_count += found_images
            image_alt_count += described_images
            warnings.extend(inline_warnings)
            if not inline_blocks:
                continue

            heading_level = _docx_heading_level(paragraph)
            list_info = _docx_list_info(paragraph, numbering_formats)
            if heading_level is not None:
                combined_text = " ".join(block["text"] for block in inline_blocks if block.get("type") == "paragraph")
                visual_blocks = [block for block in inline_blocks if block.get("type") != "paragraph"]
                if combined_text:
                    blocks.append({"type": "heading", "level": heading_level, "text": combined_text})
                blocks.extend(visual_blocks)
            elif list_info is not None and len(inline_blocks) == 1 and inline_blocks[0].get("type") == "paragraph":
                blocks.append({
                    "type": "list_item",
                    "ordered": bool(list_info["ordered"]),
                    "level": int(list_info["level"]),
                    "text": inline_blocks[0]["text"],
                })
            else:
                blocks.extend(inline_blocks)

        elif child.tag == qn("w:tbl"):
            table_index += 1
            table = Table(child, document)
            rows, cell_spans, merged, header_rows, table_warnings = _docx_table_grid(table)
            warnings.extend(table_warnings)
            if merged:
                warnings.append(f"Table {table_index} contains merged cells. Their detected spans are preserved where possible; check complex relationships in the original table.")
            if not header_rows and rows:
                warnings.append(f"Table {table_index} has no marked column headings. All rows are presented as data; check the original table to confirm the column labels.")
            block = _table_block(rows, f"Table {table_index}", header_rows=header_rows, cell_spans=cell_spans)
            if block:
                blocks.append(block)

    header_texts = []
    footer_texts = []
    for section in document.sections:
        header_texts.extend(_clean_text(paragraph.text) for paragraph in section.header.paragraphs if _clean_text(paragraph.text))
        footer_texts.extend(_clean_text(paragraph.text) for paragraph in section.footer.paragraphs if _clean_text(paragraph.text))
        if section.header.tables or section.footer.tables:
            warnings.append("Tables in document headers or footers are not included in the reading view.")
    if header_texts:
        blocks.insert(0, {"type": "heading", "level": 2, "text": "Document header"})
        blocks[1:1] = [{"type": "paragraph", "text": text} for text in dict.fromkeys(header_texts)]
    if footer_texts:
        blocks.append({"type": "heading", "level": 2, "text": "Document footer"})
        blocks.extend({"type": "paragraph", "text": text} for text in dict.fromkeys(footer_texts))

    try:
        with zipfile.ZipFile(io.BytesIO(file_data)) as archive:
            names = set(archive.namelist())
            document_xml = archive.read("word/document.xml") if "word/document.xml" in names else b""
            footnotes = _extract_word_notes(archive, "word/footnotes.xml", "footnote")
            endnotes = _extract_word_notes(archive, "word/endnotes.xml", "endnote")
        if any(name.startswith(("word/charts/", "word/diagrams/", "word/embeddings/")) for name in names):
            warnings.append("Charts, diagrams or embedded objects may be missing from the reading view. Check the original document for visual information.")
        if b"w:txbxContent" in document_xml:
            warnings.append("Some text in floating text boxes may be missing or appear in a different position. Check the original document.")
        if footnotes:
            blocks.append({"type": "heading", "level": 2, "text": "Footnotes"})
            blocks.extend({"type": "paragraph", "text": note} for note in footnotes)
            warnings.append("Footnotes are included after the main document text. Their original inline positions are not reproduced in the reading view.")
        if endnotes:
            blocks.append({"type": "heading", "level": 2, "text": "Endnotes"})
            blocks.extend({"type": "paragraph", "text": note} for note in endnotes)
            warnings.append("Endnotes are included after the main document text. Their original inline positions are not reproduced in the reading view.")
        if "word/comments.xml" in names:
            warnings.append("Review comments are not included in the reading view.")
    except zipfile.BadZipFile:
        warnings.append("Some embedded content could not be checked. Review the original document for additional charts, diagrams or objects.")

    if image_count and image_alt_count == 0:
        warnings.append("Some images have no alternative description, so their visual information may be missing from the reading view. Check the original document or add descriptions before sharing.")
    return blocks, list(dict.fromkeys(warnings)), None


def _pptx_table_grid(table) -> tuple[list[list[str]], list[list[dict[str, Any] | None]], bool]:
    """Preserve PowerPoint table merge spans without guessing header rows."""
    physical_rows = []
    grid_width = len(table.columns)
    merged = False
    for row in table._tbl.tr_lst:
        cells = []
        for column, tc in enumerate(row.tc_lst):
            try:
                colspan = max(1, int(tc.get("gridSpan", "1")))
            except ValueError:
                colspan = 1
            try:
                rowspan = max(1, int(tc.get("rowSpan", "1")))
            except ValueError:
                rowspan = 1
            h_merge = tc.get("hMerge") == "1"
            v_merge = tc.get("vMerge") == "1"
            cells.append({
                "column": column,
                "colspan": colspan,
                "rowspan": rowspan,
                "h_merge": h_merge,
                "v_merge": v_merge,
                "text": _clean_text(tc.text),
            })
            merged = merged or colspan > 1 or rowspan > 1 or h_merge or v_merge
        grid_width = max(grid_width, len(cells))
        physical_rows.append(cells)

    rows = [[""] * grid_width for _ in physical_rows]
    spans: list[list[dict[str, Any] | None]] = [[None] * grid_width for _ in physical_rows]
    active_vertical: dict[int, tuple[int, int]] = {}
    for row_index, cells in enumerate(physical_rows):
        next_vertical: dict[int, tuple[int, int]] = {}
        horizontal_source: tuple[int, int] | None = None
        for cell in cells:
            column = cell["column"]
            if cell["h_merge"]:
                if horizontal_source:
                    spans[row_index][column] = {"covered_by": [row_index, horizontal_source[1]]}
                continue
            if cell["v_merge"]:
                source = active_vertical.get(column)
                if source:
                    spans[row_index][column] = {"covered_by": [source[0], column]}
                    next_vertical[column] = source
                else:
                    rows[row_index][column] = cell["text"]
                continue

            rows[row_index][column] = cell["text"]
            colspan = cell["colspan"]
            rowspan = cell["rowspan"]
            if colspan > 1 or rowspan > 1:
                spans[row_index][column] = {"colspan": colspan, "rowspan": rowspan}
                horizontal_source = (row_index, column) if colspan > 1 else None
                for offset in range(1, colspan):
                    if column + offset < grid_width:
                        spans[row_index][column + offset] = {"covered_by": [row_index, column]}
            else:
                horizontal_source = None
            if rowspan > 1:
                next_vertical[column] = (row_index, column)
        active_vertical = next_vertical
    return rows, spans, merged


def _pptx_list_info(paragraph) -> dict[str, Any] | None:
    p_pr = paragraph._pPr
    if p_pr is None:
        return None
    level_attr = p_pr.get("lvl")
    children = {child.tag.rsplit("}", 1)[-1] for child in p_pr}
    if "buNone" in children:
        return None
    if not ("buChar" in children or "buAutoNum" in children or level_attr is not None):
        return None
    try:
        level = int(level_attr if level_attr is not None else paragraph.level)
    except (TypeError, ValueError):
        level = 0
    return {"ordered": "buAutoNum" in children, "level": max(0, min(8, level))}


def _pptx_blocks(file_data: bytes) -> tuple[list[dict[str, Any]], list[str], int | None]:
    presentation = Presentation(io.BytesIO(file_data))
    blocks: list[dict[str, Any]] = []
    warnings: list[str] = []
    image_count = 0
    image_alt_count = 0
    has_speaker_notes = False

    for slide_number, slide in enumerate(presentation.slides, start=1):
        title_shape = slide.shapes.title
        title_text = _clean_text(title_shape.text if title_shape and title_shape.has_text_frame else "")
        blocks.append({
            "type": "heading",
            "level": 2,
            "text": title_text or f"Slide {slide_number}",
        })
        content_shape_count = sum(1 for shape in slide.shapes if title_shape is None or shape.shape_id != title_shape.shape_id)
        if content_shape_count > 1:
            warnings.append(f"Slide {slide_number} contains several objects. Their extracted sequence may differ from the intended reading order. Check the slide reading order in PowerPoint.")
        for shape in slide.shapes:
            if title_shape is not None and shape.shape_id == title_shape.shape_id:
                continue
            if getattr(shape, "has_table", False):
                table = shape.table
                rows, cell_spans, merged = _pptx_table_grid(table)
                if merged:
                    warnings.append(f"The table on slide {slide_number} contains merged cells. Their detected spans are preserved where possible; check complex relationships in the original.")
                if rows:
                    warnings.append(f"The table on slide {slide_number} has no marked column headings. All rows are presented as data; check the original table to confirm the column labels.")
                block = _table_block(rows, f"Table on slide {slide_number}", header_rows=0, cell_spans=cell_spans)
                if block:
                    blocks.append(block)
            elif getattr(shape, "has_text_frame", False):
                is_title_placeholder = False
                if getattr(shape, "is_placeholder", False):
                    try:
                        placeholder_type = int(shape.placeholder_format.type)
                        is_title_placeholder = placeholder_type in {1, 3, 5}
                    except (TypeError, ValueError):
                        pass
                for paragraph in shape.text_frame.paragraphs:
                    text = _clean_text(paragraph.text)
                    if not text:
                        continue
                    list_info = _pptx_list_info(paragraph)
                    if list_info is not None:
                        blocks.append({
                            "type": "list_item",
                            "ordered": bool(list_info["ordered"]),
                            "level": int(list_info["level"]),
                            "text": text,
                        })
                    elif is_title_placeholder:
                        blocks.append({"type": "heading", "level": 3, "text": text})
                    else:
                        blocks.append({"type": "paragraph", "text": text})
            elif getattr(shape, "shape_type", None) == 13:  # PICTURE
                image_count += 1
                try:
                    alt = _clean_text(shape._element._nvXxPr.cNvPr.get("descr"))
                except Exception:
                    alt = ""
                if alt:
                    image_alt_count += 1
                    blocks.append({"type": "image_description", "text": alt})
                else:
                    warnings.append(f"An image on slide {slide_number} has no alternative description, so its visual information may be missing from the reading view.")
                    blocks.append({"type": "image_placeholder", "text": f"Image on slide {slide_number} without an alternative description."})
            elif getattr(shape, "has_chart", False):
                warnings.append(f"A chart on slide {slide_number} may not be represented fully in the reading view. Check the original slide or provide a text description.")

        if getattr(slide, "has_notes_slide", False):
            try:
                notes_text = _clean_text(slide.notes_slide.notes_text_frame.text)
            except Exception:
                notes_text = ""
            if notes_text:
                has_speaker_notes = True
                blocks.append({"type": "heading", "level": 3, "text": f"Speaker notes for slide {slide_number}"})
                blocks.append({"type": "speaker_notes", "text": notes_text})
        blocks.append({"type": "slide_break", "slide": slide_number})

    try:
        with zipfile.ZipFile(io.BytesIO(file_data)) as archive:
            names = set(archive.namelist())
        if any(name.startswith(("ppt/charts/", "ppt/diagrams/", "ppt/embeddings/")) for name in names):
            warnings.append("Charts, diagrams or embedded objects may be missing from the reading view. Check the original presentation for visual information.")
    except zipfile.BadZipFile:
        warnings.append("Some embedded content could not be checked. Review the original presentation for additional charts, diagrams or objects.")

    if has_speaker_notes:
        warnings.append("Speaker notes are included after each slide. Review them for presenter-only information before sharing the presentation.")
    if image_count and image_alt_count == 0:
        warnings.append("Some presentation images have no alternative description, so their visual information may be missing from the reading view. Check the original slides or add descriptions before sharing.")
    return blocks, list(dict.fromkeys(warnings)), len(presentation.slides)


def _pdf_tag_warning(reader: PdfReader) -> str | None:
    try:
        root = reader.trailer.get("/Root")
        root = root.get_object() if hasattr(root, "get_object") else root
        struct_tree = root.get("/StructTreeRoot") if root else None
        mark_info = root.get("/MarkInfo") if root else None
        mark_info = mark_info.get_object() if hasattr(mark_info, "get_object") else mark_info
        marked = bool(mark_info.get("/Marked")) if mark_info else False
        if not struct_tree or not marked:
            return "This PDF does not contain reliable accessibility structure. Headings, reading order, tables and image descriptions may need checking in the original."
        return "This PDF contains accessibility information, but Voxora cannot yet verify whether its reading order, headings, tables and image descriptions are correct. Check the original if structure is important."
    except Exception:
        return "PDF accessibility structure could not be checked. Verify reading order and structure in the original file."


def _ocr_pdf_page(pdfium_document, page_index: int) -> str:
    import pypdfium2 as pdfium  # noqa: F401 - optional renderer, imported only when OCR is needed
    import pytesseract

    page = pdfium_document[page_index]
    bitmap = None
    image = None
    try:
        bitmap = page.render(scale=1.6)
        image = bitmap.to_pil()
        return _clean_text(pytesseract.image_to_string(
            image,
            lang=OCR_LANG,
            config="--psm 3",
            timeout=OCR_TIMEOUT_SECONDS,
        ))
    finally:
        if image is not None:
            image.close()
        if bitmap is not None:
            bitmap.close()
        page.close()


def _extract_pdf_page_text(page) -> tuple[str, bool]:
    """Prefer pypdf's layout-aware extraction, with a compatible fallback."""
    try:
        return _clean_text(page.extract_text(extraction_mode="layout") or ""), True
    except (TypeError, ValueError, NotImplementedError):
        return _clean_text(page.extract_text() or ""), False
    except Exception:
        # Some malformed page resources fail only in layout mode. Preserve the
        # previous extraction path rather than discarding otherwise readable text.
        try:
            return _clean_text(page.extract_text() or ""), False
        except Exception:
            return "", False


def _pdf_blocks(pdf_data: bytes, *, allow_ocr: bool = True) -> tuple[list[dict[str, Any]], list[str], int | None, str]:
    warnings: list[str] = []
    blocks: list[dict[str, Any]] = []
    reader = PdfReader(io.BytesIO(pdf_data), strict=False)
    if reader.is_encrypted:
        try:
            if not reader.decrypt(""):
                return [], ["This PDF is password-protected. Remove its password protection before uploading it."], None, "pypdf"
        except Exception:
            return [], ["This PDF is password-protected and could not be opened."], None, "pypdf"

    total_pages = len(reader.pages)
    page_limit = min(total_pages, MAX_DOCUMENT_PAGES)
    if total_pages > page_limit:
        warnings.append(f"Only the first {page_limit} of {total_pages} pages could be prepared for the reading view. Download the original to access the remaining pages.")

    page_texts: list[str] = []
    sparse_pages: list[int] = []
    layout_fallback_used = False
    for index in range(page_limit):
        text, layout_used = _extract_pdf_page_text(reader.pages[index])
        if not layout_used:
            layout_fallback_used = True
        if not text:
            warnings.append(f"Text extraction failed or returned no readable text on page {index + 1}.")
        page_texts.append(text)
        if len(text) < 40:
            sparse_pages.append(index)
    if layout_fallback_used:
        warnings.append("The page layout could not be fully preserved during text extraction. Check the original PDF for complex layouts.")
    elif any(page_texts):
        warnings.append("Complex multi-column layouts and floating content may not read in the intended order. Check the original PDF.")

    ocr_used = False
    if sparse_pages:
        if not allow_ocr:
            warnings.append("Some converted pages contain scanned content that could not be read. Try uploading a searchable PDF or a clearer scan.")
        elif not shutil.which("tesseract"):
            warnings.append("Some pages contain scanned content that could not be read. Try uploading a searchable PDF or a clearer scan.")
        elif MAX_OCR_PAGES <= 0:
            warnings.append("Some scanned pages could not be read automatically. Try uploading a searchable PDF or a clearer scan.")
        else:
            try:
                import pypdfium2 as pdfium
                pdfium_document = pdfium.PdfDocument(pdf_data)
                try:
                    for page_index in sparse_pages[:MAX_OCR_PAGES]:
                        try:
                            ocr_text = _ocr_pdf_page(pdfium_document, page_index)
                            if len(ocr_text) > len(page_texts[page_index]):
                                page_texts[page_index] = ocr_text
                                ocr_used = bool(ocr_text) or ocr_used
                            if len(page_texts[page_index]) < 40:
                                warnings.append(f"Page {page_index + 1} could not be read clearly. Check the original page or try a clearer scan.")
                        except Exception:
                            warnings.append(f"Page {page_index + 1} could not be read. Check the original page or try a clearer scan.")
                finally:
                    pdfium_document.close()
                if len(sparse_pages) > MAX_OCR_PAGES:
                    warnings.append(f"Only the first {MAX_OCR_PAGES} scanned pages were processed; {len(sparse_pages) - MAX_OCR_PAGES} additional scanned pages may be missing from the reading view.")
            except Exception:
                warnings.append("Some scanned pages could not be read. Try uploading a searchable PDF or a clearer scan.")

    for page_number, page_text in enumerate(page_texts, start=1):
        if not page_text:
            continue
        if any(block.get("type") == "heading" for block in blocks):
            blocks.append({"type": "page_break", "page": page_number})
        blocks.append({"type": "heading", "level": 2, "text": f"Page {page_number}"})
        blocks.extend(_paragraph_blocks(page_text))

    tag_warning = _pdf_tag_warning(reader)
    if tag_warning:
        warnings.append(tag_warning)
    if any(len(text) < 40 for text in page_texts):
        warnings.append("Some pages may contain diagrams, tables or other visual information that is not represented in the reading view. Check the original document.")
    method = "pypdf+ocr" if ocr_used else "pypdf"
    return blocks, list(dict.fromkeys(warnings)), total_pages, method


def _block_text(block: dict[str, Any]) -> str:
    kind = block.get("type")
    if kind == "table":
        return "\n".join(" | ".join(row) for row in block.get("rows", []))
    if kind in {"heading", "paragraph", "list_item", "image_description", "image_placeholder", "speaker_notes"}:
        return _clean_text(block.get("text"))
    if kind in {"page_break", "slide_break"}:
        return ""
    return ""


def _finalize(
    blocks: list[dict[str, Any]],
    warnings: list[str],
    method: str,
    page_count: int | None = None,
    *,
    partial: bool = False,
    empty_status: str = "failed",
) -> dict[str, Any]:
    if any(block.get("truncated_rows") for block in blocks):
        warnings.append(f"A large table is shown with only its first {MAX_TABLE_ROWS} rows. Download the original to view the complete table.")
        partial = True
    if any(block.get("truncated_columns") for block in blocks):
        warnings.append(f"A wide table is shown with only its first {MAX_TABLE_COLUMNS} columns. Download the original to view the complete table.")
        partial = True
    bounded_blocks: list[dict[str, Any]] = []
    text_parts: list[str] = []
    remaining = MAX_EXTRACTED_TEXT_CHARS
    truncated = False

    for block in blocks:
        if len(bounded_blocks) >= 5000 or remaining <= 0:
            truncated = True
            break
        value = _block_text(block)
        if not value:
            bounded_blocks.append(block)
            continue
        if len(value) > remaining:
            copied = dict(block)
            if copied.get("type") == "table":
                rows = []
                for row_index, row in enumerate(copied.get("rows", [])):
                    if remaining <= 0:
                        break
                    if row_index:
                        if remaining < 1:
                            break
                        remaining -= 1  # newline between serialized rows
                    new_row = []
                    for column_index, cell in enumerate(row):
                        if column_index:
                            if remaining < 3:
                                break
                            remaining -= 3  # " | " between serialized cells
                        part = cell[:remaining]
                        new_row.append(part)
                        remaining -= len(part)
                        if len(part) < len(cell):
                            break
                    if new_row:
                        rows.append(new_row)
                    if len(new_row) < len(row):
                        break
                copied["rows"] = rows
                if isinstance(copied.get("cell_spans"), list):
                    copied["cell_spans"] = copied["cell_spans"][:len(rows)]
                    for span_row in copied["cell_spans"]:
                        if isinstance(span_row, list):
                            span_row[:] = span_row[:max((len(row) for row in rows), default=0)]
            else:
                copied["text"] = str(copied.get("text", ""))[:remaining]
                remaining -= len(copied["text"])
            bounded_blocks.append(copied)
            text_parts.append(_block_text(copied))
            truncated = True
            break
        bounded_blocks.append(block)
        text_parts.append(value)
        remaining -= len(value)

    if len(bounded_blocks) < len(blocks):
        truncated = True
    if truncated:
        warnings.append("Only part of the document could be included in the reading view. Download the original to access the complete document.")
        partial = True

    extracted_text = "\n\n".join(part for part in text_parts if part).strip()
    warnings = list(dict.fromkeys(warnings))
    if extracted_text:
        status = "partial" if partial else "ready"
    else:
        status = empty_status
    return {
        "text": extracted_text,
        "blocks": bounded_blocks,
        "status": status,
        "method": method,
        "warnings": warnings,
        "page_count": page_count,
        "truncated": truncated,
    }


def extract_document(
    file_data: bytes,
    original_name: str,
    extension: str,
    *,
    preview_pdf: bytes | None = None,
) -> dict[str, Any]:
    """Extract bounded, ordered text blocks from a supported Voxora upload."""
    extension = (extension or "").lower().lstrip(".")
    if not file_data:
        return _finalize([], ["The uploaded file is empty."], "none")

    try:
        if extension == "pdf":
            blocks, warnings, page_count, method = _pdf_blocks(file_data)
            has_readable_body = any(
                block.get("type") in {"paragraph", "table", "list_item", "image_description"}
                and _block_text(block)
                for block in blocks
            )
            needs_ocr = not has_readable_body and any(
                "scanned" in warning.lower() or "could not be read" in warning.lower()
                for warning in warnings
            )
            return _finalize(
                blocks, warnings, method, page_count,
                partial=bool(warnings),
                empty_status="needs_ocr" if needs_ocr else "failed",
            )

        if extension == "docx":
            blocks, warnings, page_count = _docx_blocks(file_data)
            return _finalize(blocks, warnings, "python-docx", page_count, partial=bool(warnings))

        if extension == "pptx":
            blocks, warnings, page_count = _pptx_blocks(file_data)
            return _finalize(blocks, warnings, "python-pptx", page_count, partial=bool(warnings))

        if extension in {"txt", "md"}:
            decoded = file_data.decode("utf-8-sig", errors="replace")
            blocks = _markdown_blocks(decoded) if extension == "md" else _paragraph_blocks(decoded)
            return _finalize(blocks, [], "markdown" if extension == "md" else "plain-text")

        if extension == "csv":
            decoded = file_data.decode("utf-8-sig", errors="replace")
            blocks, warnings = _csv_blocks(decoded)
            return _finalize(blocks, warnings, "csv", partial=bool(warnings))

        if extension in {"rtf", "odt", "ods", "odp"}:
            if not preview_pdf:
                return _finalize(
                    [],
                    ["A reading view could not be prepared for this file. Check that the document opens correctly, or try another copy."],
                    "libreoffice-pdf",
                )
            blocks, warnings, page_count, _ = _pdf_blocks(preview_pdf, allow_ocr=False)
            warnings.append("The reading view was prepared from a PDF preview. Some formatting, table and slide relationships may not be preserved; check the original document.")
            return _finalize(blocks, warnings, "libreoffice-pdf-text", page_count, partial=True, empty_status="failed")

        return _finalize([], ["A reading view is not available for this file type yet. You can still download the original document."], "unsupported")
    except Exception as exc:
        # Do not log or return file contents. The caller can retain the original upload.
        return _finalize(
            [],
            ["A reading view could not be prepared for this file. The original upload is still available."],
            "error",
        )
