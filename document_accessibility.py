"""Bounded document text extraction for Voxora's accessible reading view.

This module creates a semantic, text-first representation of supported uploads.
It does not rewrite or certify the original file as an accessible PDF.
"""

from __future__ import annotations

import csv
import io
import os
import re
import shutil
import zipfile
from typing import Any

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
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


def _table_block(rows: list[list[str]], caption: str, header_rows: int = 1) -> dict[str, Any] | None:
    rows_truncated = len(rows) > MAX_TABLE_ROWS
    columns_truncated = any(len(row) > MAX_TABLE_COLUMNS for row in rows)
    clean_rows = []
    for row in rows[:MAX_TABLE_ROWS]:
        clean = [_clean_text(cell) for cell in row[:MAX_TABLE_COLUMNS]]
        if any(clean):
            clean_rows.append(clean)
    if not clean_rows:
        return None
    width = max(len(row) for row in clean_rows)
    clean_rows = [row + [""] * (width - len(row)) for row in clean_rows]
    return {
        "type": "table",
        "caption": _clean_text(caption),
        "rows": clean_rows,
        "header_rows": 1 if header_rows else 0,
        "truncated_rows": rows_truncated,
        "truncated_columns": columns_truncated,
    }


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
    warnings.append("The first CSV row is presented as the table header. Confirm that it contains column names rather than data.")
    if any(len(row) > MAX_TABLE_COLUMNS for row in rows):
        rows = [row[:MAX_TABLE_COLUMNS] for row in rows]
        warnings.append(f"Only the first {MAX_TABLE_COLUMNS} columns are available in the accessible table.")
    table = _table_block(rows, "CSV data", header_rows=1)
    return ([table] if table else []), warnings


def _docx_blocks(file_data: bytes) -> tuple[list[dict[str, Any]], list[str], int | None]:
    document = Document(io.BytesIO(file_data))
    blocks: list[dict[str, Any]] = []
    warnings: list[str] = []
    table_index = 0
    image_count = 0
    image_alt_count = 0

    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            paragraph = Paragraph(child, document)
            text = _clean_text(paragraph.text)
            style_name = (paragraph.style.name if paragraph.style else "").strip()
            if text:
                heading_match = re.match(r"Heading\s+(\d+)", style_name, re.I)
                if heading_match:
                    level = min(6, int(heading_match.group(1)) + 1)
                    blocks.append({"type": "heading", "level": level, "text": text})
                elif style_name.lower() == "title":
                    blocks.append({"type": "heading", "level": 2, "text": text})
                elif "list bullet" in style_name.lower() or "list number" in style_name.lower():
                    blocks.append({
                        "type": "list_item",
                        "ordered": "list number" in style_name.lower(),
                        "text": text,
                    })
                else:
                    blocks.append({"type": "paragraph", "text": text})

            for drawing in paragraph._p.xpath(".//wp:docPr"):
                image_count += 1
                alt = _clean_text(drawing.get("descr") or drawing.get("title"))
                if alt:
                    image_alt_count += 1
                    blocks.append({"type": "image_description", "text": alt})
                else:
                    warnings.append("At least one embedded image has no alternative description in the source document.")

        elif child.tag == qn("w:tbl"):
            table_index += 1
            table = Table(child, document)
            rows = [[cell.text for cell in row.cells] for row in table.rows]
            has_header = False
            if table.rows:
                tr_pr = table.rows[0]._tr.trPr
                has_header = bool(tr_pr is not None and tr_pr.find(qn("w:tblHeader")) is not None)
            if not has_header and rows:
                warnings.append(f"Table {table_index} has no explicitly marked header row; the first row is presented as its header.")
                has_header = True
            block = _table_block(rows, f"Table {table_index}", header_rows=1 if has_header else 0)
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
        if any(name.startswith(("word/charts/", "word/diagrams/", "word/embeddings/")) for name in names):
            warnings.append("Embedded charts, diagrams or objects in the Word document may not be represented in the reading view.")
        if names.intersection({"word/footnotes.xml", "word/endnotes.xml", "word/comments.xml"}):
            warnings.append("Footnotes, endnotes or comments may not be included in the reading view.")
    except zipfile.BadZipFile:
        warnings.append("The Word document package could not be fully inspected for embedded content.")

    if image_count and image_alt_count == 0:
        warnings.append("Images were found but no alternative text was available; visual information may be missing from the reading view. If these are scanned pages, export the document as a PDF and upload the PDF for OCR.")
    page_count = None
    return blocks, list(dict.fromkeys(warnings)), page_count


def _pptx_blocks(file_data: bytes) -> tuple[list[dict[str, Any]], list[str], int | None]:
    presentation = Presentation(io.BytesIO(file_data))
    blocks: list[dict[str, Any]] = []
    warnings: list[str] = []
    image_count = 0
    image_alt_count = 0

    for slide_number, slide in enumerate(presentation.slides, start=1):
        title_shape = slide.shapes.title
        title_text = _clean_text(title_shape.text if title_shape and title_shape.has_text_frame else "")
        blocks.append({
            "type": "heading",
            "level": 2,
            "text": title_text or f"Slide {slide_number}",
        })
        for shape in slide.shapes:
            if title_shape is not None and shape.shape_id == title_shape.shape_id:
                continue
            if getattr(shape, "has_table", False):
                table = shape.table
                rows = [[cell.text for cell in row.cells] for row in table.rows]
                header = bool(rows)
                if rows:
                    warnings.append(f"The first row of a PowerPoint table on slide {slide_number} is presented as its header. Confirm that this matches the source table.")
                block = _table_block(rows, f"Table on slide {slide_number}", header_rows=1 if header else 0)
                if block:
                    blocks.append(block)
            elif getattr(shape, "has_text_frame", False):
                for paragraph in shape.text_frame.paragraphs:
                    text = _clean_text(paragraph.text)
                    if text:
                        if paragraph.level > 0:
                            blocks.append({"type": "list_item", "ordered": False, "text": text})
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
                    warnings.append(f"An image on slide {slide_number} has no alternative description.")
            elif getattr(shape, "has_chart", False):
                warnings.append(f"A chart on slide {slide_number} may need a separate text description.")

        blocks.append({"type": "slide_break", "slide": slide_number})

    try:
        with zipfile.ZipFile(io.BytesIO(file_data)) as archive:
            names = set(archive.namelist())
        if any(name.startswith(("ppt/charts/", "ppt/diagrams/", "ppt/embeddings/")) for name in names):
            warnings.append("Embedded charts, SmartArt or objects in the presentation may not be represented in the reading view.")
        if any(name.startswith("ppt/notesSlides/") for name in names):
            warnings.append("Speaker notes are not included in the reading view.")
    except zipfile.BadZipFile:
        warnings.append("The presentation package could not be fully inspected for embedded content.")

    if image_count and image_alt_count == 0:
        warnings.append("Presentation images were found but no alternative text was available. If these are scanned pages, export the presentation as a PDF and upload the PDF for OCR.")
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
            return "The PDF does not expose a complete tagged-PDF structure. Reading order, headings, table semantics and alternative text may need manual verification."
        return "A tagged-PDF structure is declared, but Voxora does not read its tag tree or validate reading order, heading hierarchy, table semantics or alternative text."
    except Exception:
        return "PDF accessibility tags could not be inspected; verify reading order and structure in the original file."


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
        warnings.append(f"Only the first {page_limit} of {total_pages} pages were processed. The document is too long for the current extraction limit.")

    page_texts: list[str] = []
    sparse_pages: list[int] = []
    for index in range(page_limit):
        try:
            text = _clean_text(reader.pages[index].extract_text() or "")
        except Exception:
            text = ""
            warnings.append(f"Text extraction failed on page {index + 1}.")
        page_texts.append(text)
        if len(text) < 40:
            sparse_pages.append(index)

    ocr_used = False
    if sparse_pages:
        if not allow_ocr:
            warnings.append("Some converted office pages contain little selectable text. Image-only content was not OCR-processed; export the original as a PDF to run scanned-page OCR.")
        elif not shutil.which("tesseract"):
            warnings.append("Some pages contain little or no selectable text. OCR is not installed on this server.")
        elif MAX_OCR_PAGES <= 0:
            warnings.append("Some pages contain little or no selectable text. OCR is disabled by server configuration.")
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
                                warnings.append(f"Page {page_index + 1} remains difficult to read after OCR.")
                        except Exception:
                            warnings.append(f"OCR could not process page {page_index + 1}.")
                finally:
                    pdfium_document.close()
                if len(sparse_pages) > MAX_OCR_PAGES:
                    warnings.append(f"OCR was limited to {MAX_OCR_PAGES} pages; {len(sparse_pages) - MAX_OCR_PAGES} additional sparse pages were not processed.")
            except Exception:
                warnings.append("OCR could not be started for this PDF. Check the server's OCR dependencies and language data.")

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
        warnings.append("Some pages may contain diagrams, tables or other visual information that text extraction cannot represent.")
    method = "pypdf+ocr" if ocr_used else "pypdf"
    return blocks, list(dict.fromkeys(warnings)), total_pages, method


def _block_text(block: dict[str, Any]) -> str:
    kind = block.get("type")
    if kind == "table":
        return "\n".join(" | ".join(row) for row in block.get("rows", []))
    if kind in {"heading", "paragraph", "list_item", "image_description"}:
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
        warnings.append(f"One or more tables were limited to the first {MAX_TABLE_ROWS} rows.")
        partial = True
    if any(block.get("truncated_columns") for block in blocks):
        warnings.append(f"One or more tables were limited to the first {MAX_TABLE_COLUMNS} columns.")
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
                for row in copied.get("rows", []):
                    if remaining <= 0:
                        break
                    new_row = []
                    for cell in row:
                        if remaining <= 0:
                            break
                        part = cell[:remaining]
                        new_row.append(part)
                        remaining -= len(part)
                    rows.append(new_row)
                copied["rows"] = rows
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
        warnings.append(f"Accessible text was limited to {MAX_EXTRACTED_TEXT_CHARS:,} characters. Download the original to inspect the complete document.")
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
            needs_ocr = not has_readable_body and any("OCR" in warning for warning in warnings)
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
                    ["The document could not be converted for text extraction. Check that LibreOffice is installed and the file is valid."],
                    "libreoffice-pdf",
                )
            blocks, warnings, page_count, _ = _pdf_blocks(preview_pdf, allow_ocr=False)
            warnings.append("This format was converted to PDF before extraction. Table, slide and document semantics may be flattened; verify the original file as well.")
            return _finalize(blocks, warnings, "libreoffice-pdf-text", page_count, partial=True, empty_status="failed")

        return _finalize([], [f"Text extraction is not configured for .{extension} files."], "unsupported")
    except Exception as exc:
        # Do not log or return file contents. The caller can retain the original upload.
        return _finalize(
            [],
            [f"Text extraction failed for this file ({type(exc).__name__}). The original upload is retained."],
            "error",
        )
