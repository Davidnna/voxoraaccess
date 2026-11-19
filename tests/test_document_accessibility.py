"""Unit tests for Voxora's bounded, structured document extraction."""

import io
import zipfile
import unittest
from unittest.mock import patch

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pptx import Presentation
from pptx.util import Inches
from PIL import Image

import document_accessibility as documents


def make_pdf(pages, *, tagged=False):
    """Create a small text PDF without relying on an external PDF generator."""
    objects = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R" + (b" /MarkInfo << /Marked true >> /StructTreeRoot 6 0 R" if tagged else b"") + b" >>")
    page_refs = " ".join(f"{3 + index * 2} 0 R" for index in range(len(pages)))
    objects.append(f"<< /Type /Pages /Kids [{page_refs}] /Count {len(pages)} >>".encode())
    for index, text in enumerate(pages):
        page_id = 3 + index * 2
        content_id = page_id + 1
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {3 + len(pages) * 2} 0 R >> >> "
            f"/Contents {content_id} 0 R >>".encode()
        )
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode()
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    font_id = 3 + len(pages) * 2
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    if tagged:
        objects.append(b"<< /Type /StructTreeRoot /K [] >>")

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for object_id, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{object_id} 0 obj\n".encode())
        output.extend(body)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode()
    )
    return bytes(output)


class DocumentAccessibilityTests(unittest.TestCase):
    def test_plain_text_is_extracted_into_paragraph_blocks(self):
        result = documents.extract_document(
            b"Introduction\n\nA paragraph with readable content.", "notes.txt", "txt"
        )
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["method"], "plain-text")
        self.assertEqual([block["type"] for block in result["blocks"]], ["paragraph", "paragraph"])
        self.assertIn("A paragraph with readable content.", result["text"])

    def test_markdown_headings_lists_and_tables_keep_structure(self):
        source = b"# Main topic\n\n## Subtopic\n\nA paragraph.\n\n- First item\n- Second item\n\n| Name | Score |\n| --- | --- |\n| Ada | 10 |"
        result = documents.extract_document(source, "notes.md", "md")
        self.assertEqual(result["status"], "ready")
        self.assertEqual([block["type"] for block in result["blocks"]], [
            "heading", "heading", "paragraph", "list_item", "list_item", "table"
        ])
        self.assertEqual(result["blocks"][0]["level"], 2)
        self.assertEqual(result["blocks"][-1]["rows"][1], ["Ada", "10"])

    def test_csv_does_not_assume_the_first_row_is_a_header(self):
        result = documents.extract_document(
            b"Student,Score\nAda,10\nGrace,9", "scores.csv", "csv"
        )
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["method"], "csv")
        self.assertTrue(any("does not identify them" in warning for warning in result["warnings"]))
        table = result["blocks"][0]
        self.assertEqual(table["type"], "table")
        self.assertEqual(table["header_rows"], 0)
        self.assertEqual(table["rows"][0], ["Student", "Score"])

    def test_docx_preserves_heading_paragraph_and_table_order(self):
        document = Document()
        document.add_heading("Document title", level=1)
        document.add_heading("Learning outcomes", level=2)
        document.add_paragraph("Students should understand the topic.")
        table = document.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "Outcome"
        table.cell(0, 1).text = "Status"
        table.cell(1, 0).text = "Reading"
        table.cell(1, 1).text = "Complete"
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "lesson.docx", "docx")
        self.assertEqual(result["method"], "python-docx")
        self.assertIn("Document title", result["text"])
        self.assertIn("Reading | Complete", result["text"])
        self.assertEqual([block["type"] for block in result["blocks"]], [
            "heading", "heading", "paragraph", "table"
        ])
        self.assertEqual(result["blocks"][1]["level"], 3)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["blocks"][-1]["header_rows"], 0)
        self.assertTrue(any("no marked column headings" in warning for warning in result["warnings"]))

    def test_docx_reports_merged_table_cells(self):
        document = Document()
        table = document.add_table(rows=2, cols=2)
        table.cell(0, 0).merge(table.cell(0, 1)).text = "Merged heading"
        table.cell(1, 0).text = "First value"
        table.cell(1, 1).text = "Second value"
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "merged.docx", "docx")
        self.assertTrue(any("contains merged cells" in warning for warning in result["warnings"]))

    def test_docx_preserves_only_an_explicitly_marked_header_row(self):
        document = Document()
        table = document.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "Outcome"
        table.cell(0, 1).text = "Status"
        table.cell(1, 0).text = "Reading"
        table.cell(1, 1).text = "Complete"
        header_properties = table.rows[0]._tr.get_or_add_trPr()
        header_marker = OxmlElement("w:tblHeader")
        header_marker.set(qn("w:val"), "true")
        header_properties.append(header_marker)
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "marked.docx", "docx")
        table_block = next(block for block in result["blocks"] if block["type"] == "table")
        self.assertEqual(table_block["header_rows"], 1)

    def test_docx_reports_images_without_alternative_text(self):
        image = Image.new("RGB", (12, 12), "white")
        image_buffer = io.BytesIO()
        image.save(image_buffer, format="PNG")
        image_buffer.seek(0)
        document = Document()
        paragraph = document.add_paragraph("Figure follows.")
        paragraph.add_run().add_picture(image_buffer)
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "figures.docx", "docx")
        self.assertTrue(any("no alternative description" in warning for warning in result["warnings"]))
        self.assertTrue(any(block["type"] == "paragraph" and block["text"] == "Figure follows." for block in result["blocks"]))
        self.assertEqual(result["status"], "partial")

    def test_docx_header_and_footer_text_are_included(self):
        document = Document()
        document.sections[0].header.paragraphs[0].text = "Course code: EDU101"
        document.add_paragraph("Main lesson content.")
        document.sections[0].footer.paragraphs[0].text = "University learning material"
        buffer = io.BytesIO()
        document.save(buffer)
        result = documents.extract_document(buffer.getvalue(), "lesson.docx", "docx")
        self.assertIn("Course code: EDU101", result["text"])
        self.assertIn("University learning material", result["text"])

    def test_pptx_preserves_slide_titles_text_and_tables(self):
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        slide.shapes.title.text = "Introduction"
        textbox = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(5), Inches(1))
        textbox.text = "A key concept from the lecture."
        table_shape = slide.shapes.add_table(2, 2, Inches(1), Inches(4), Inches(5), Inches(1))
        table_shape.table.cell(0, 0).text = "Term"
        table_shape.table.cell(0, 1).text = "Meaning"
        table_shape.table.cell(1, 0).text = "Access"
        table_shape.table.cell(1, 1).text = "Ability to use information"
        buffer = io.BytesIO()
        presentation.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "lecture.pptx", "pptx")
        self.assertEqual(result["method"], "python-pptx")
        self.assertEqual(result["page_count"], 1)
        self.assertIn("Introduction", result["text"])
        self.assertIn("A key concept from the lecture.", result["text"])
        table_block = next(block for block in result["blocks"] if block["type"] == "table")
        self.assertEqual(table_block["header_rows"], 0)
        self.assertTrue(any("no marked column headings" in warning for warning in result["warnings"]))

    def test_pptx_image_alternative_text_is_preserved(self):
        image = Image.new("RGB", (12, 12), "white")
        image_buffer = io.BytesIO()
        image.save(image_buffer, format="PNG")
        image_buffer.seek(0)
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        slide.shapes.title.text = "Illustration"
        picture = slide.shapes.add_picture(image_buffer, Inches(1), Inches(2))
        picture._element._nvXxPr.cNvPr.set("descr", "A small white square used as an example image.")
        buffer = io.BytesIO()
        presentation.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "illustration.pptx", "pptx")
        self.assertTrue(any(
            block["type"] == "image_description" and "small white square" in block["text"]
            for block in result["blocks"]
        ))

    def test_pdf_text_is_split_by_page_and_tagging_is_reported(self):
        result = documents.extract_document(
            make_pdf(["First page contains enough selectable text to avoid OCR.", "Second page also contains enough selectable text for extraction."]),
            "lecture.pdf",
            "pdf",
        )
        self.assertEqual(result["page_count"], 2)
        self.assertIn("First page contains enough selectable text to avoid OCR.", result["text"])
        self.assertIn("Second page also contains enough selectable text for extraction.", result["text"])
        self.assertEqual([block["text"] for block in result["blocks"] if block["type"] == "heading"], ["Page 1", "Page 2"])
        self.assertTrue(any("accessibility structure" in warning for warning in result["warnings"]))
        self.assertEqual(result["status"], "partial")

    def test_pdf_tag_structure_is_not_mistaken_for_a_full_accessibility_check(self):
        result = documents.extract_document(
            make_pdf(["Tagged PDF content has enough selectable text for this test."], tagged=True),
            "tagged.pdf",
            "pdf",
        )
        self.assertTrue(any("cannot yet verify whether its reading order" in warning for warning in result["warnings"]))

    def test_converted_open_document_formats_extract_text_and_report_flattening(self):
        preview = make_pdf(["Converted document text is available for reading."])
        for extension in ["rtf", "odt", "ods", "odp"]:
            with self.subTest(extension=extension):
                result = documents.extract_document(
                    b"original office document", f"sample.{extension}", extension,
                    preview_pdf=preview,
                )
                self.assertIn("Converted document text is available for reading.", result["text"])
                self.assertEqual(result["method"], "libreoffice-pdf-text")
                self.assertEqual(result["status"], "partial")
                self.assertTrue(any("may not be preserved" in warning for warning in result["warnings"]))

    def test_oversized_tables_are_truncated_with_an_accessibility_warning(self):
        rows = [["Column A", "Column B"]] + [[str(index), "Value"] for index in range(documents.MAX_TABLE_ROWS + 1)]
        block = documents._table_block(rows, "Large table", header_rows=1)
        result = documents._finalize([block], [], "test")
        self.assertEqual(len(block["rows"]), documents.MAX_TABLE_ROWS)
        self.assertTrue(block["truncated_rows"])
        self.assertEqual(result["status"], "partial")
        self.assertTrue(any("shown with only its first" in warning for warning in result["warnings"]))

    def test_pdf_page_limit_is_reported(self):
        with patch.object(documents, "MAX_DOCUMENT_PAGES", 1):
            result = documents.extract_document(
                make_pdf(["First page has enough readable selectable text for this test.", "Second page has readable content."]),
                "long.pdf", "pdf",
            )
        self.assertEqual(result["page_count"], 2)
        self.assertIn("First page has enough readable selectable text for this test.", result["text"])
        self.assertNotIn("Second page has readable content.", result["text"])
        self.assertTrue(any("Only the first 1 of 2 pages" in warning for warning in result["warnings"]))

    def test_scanned_pdf_uses_ocr_when_tesseract_is_available(self):
        class FakeImage:
            def close(self):
                pass

        class FakeBitmap:
            def to_pil(self):
                return FakeImage()

            def close(self):
                pass

        class FakePage:
            def render(self, scale):
                self.scale = scale
                return FakeBitmap()

            def close(self):
                pass

        class FakePdfiumDocument:
            def __init__(self, data):
                self.data = data

            def __getitem__(self, index):
                return FakePage()

            def close(self):
                pass

        with patch("document_accessibility.shutil.which", return_value="/usr/bin/tesseract"), \
             patch("pypdfium2.PdfDocument", FakePdfiumDocument), \
             patch("pytesseract.image_to_string", return_value="Recognised words from a scanned lecture page."):
            result = documents.extract_document(make_pdf([""]), "scan.pdf", "pdf")

        self.assertIn("Recognised words from a scanned lecture page.", result["text"])
        self.assertEqual(result["method"], "pypdf+ocr")

    def test_scanned_pdf_reports_ocr_unavailable_instead_of_claiming_success(self):
        with patch("document_accessibility.shutil.which", return_value=None):
            result = documents.extract_document(make_pdf([""]), "scan.pdf", "pdf")
        self.assertEqual(result["status"], "needs_ocr")
        self.assertFalse(result["text"])
        self.assertTrue(any("scanned content that could not be read" in warning for warning in result["warnings"]))

    def test_extraction_is_bounded_and_reports_truncation(self):
        with patch.object(documents, "MAX_EXTRACTED_TEXT_CHARS", 32):
            result = documents.extract_document(("word " * 30).encode(), "long.txt", "txt")
        self.assertLessEqual(len(result["text"]), 32)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["status"], "partial")
        self.assertTrue(any("Only part of the document" in warning for warning in result["warnings"]))

    def test_corrupt_docx_is_reported_without_discarding_original_upload(self):
        result = documents.extract_document(b"not a Word file", "broken.docx", "docx")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["method"], "error")
        self.assertTrue(any("original upload is still available" in warning for warning in result["warnings"]))

    def test_open_document_formats_require_successful_libreoffice_conversion(self):
        result = documents.extract_document(b"document", "notes.odt", "odt")
        self.assertEqual(result["status"], "failed")
        self.assertTrue(any("could not be prepared for this file" in warning for warning in result["warnings"]))

    def test_docx_custom_heading_styles_and_outline_levels_are_preserved(self):
        document = Document()
        custom = document.styles.add_style("Custom Section", WD_STYLE_TYPE.PARAGRAPH)
        custom.base_style = document.styles["Heading 2"]
        document.add_paragraph("Custom section heading", style=custom)
        direct = document.add_paragraph("Direct outline heading")
        outline = OxmlElement("w:outlineLvl")
        outline.set(qn("w:val"), "3")
        direct._p.get_or_add_pPr().append(outline)
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "headings.docx", "docx")
        headings = [block for block in result["blocks"] if block["type"] == "heading"]
        self.assertEqual([(block["text"], block["level"]) for block in headings], [
            ("Custom section heading", 3),
            ("Direct outline heading", 5),
        ])

    def test_docx_nested_bullet_and_numbered_lists_keep_type_and_level(self):
        document = Document()
        document.add_paragraph("Top bullet", style="List Bullet")
        document.add_paragraph("Nested bullet", style="List Bullet 2")
        document.add_paragraph("Numbered item", style="List Number")
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "lists.docx", "docx")
        items = [block for block in result["blocks"] if block["type"] == "list_item"]
        self.assertEqual([item["text"] for item in items], ["Top bullet", "Nested bullet", "Numbered item"])
        self.assertEqual([item["level"] for item in items], [0, 1, 0])
        self.assertEqual([item["ordered"] for item in items], [False, False, True])

    def test_docx_inline_visual_descriptions_keep_their_position_in_a_paragraph(self):
        image = Image.new("RGB", (12, 12), "white")
        image_buffer = io.BytesIO()
        image.save(image_buffer, format="PNG")
        image_buffer.seek(0)
        document = Document()
        paragraph = document.add_paragraph()
        paragraph.add_run("Before image")
        picture = paragraph.add_run().add_picture(image_buffer)
        picture._inline.docPr.set("descr", "A labelled example image")
        paragraph.add_run("After image")
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "inline-image.docx", "docx")
        content = [block for block in result["blocks"] if block["type"] in {"paragraph", "image_description"}]
        self.assertEqual([block["type"] for block in content], ["paragraph", "image_description", "paragraph"])
        self.assertEqual([block["text"] for block in content], ["Before image", "A labelled example image", "After image"])

    def test_docx_preserves_multiple_explicit_repeating_header_rows(self):
        document = Document()
        table = document.add_table(rows=3, cols=2)
        table.cell(0, 0).text = "Group"
        table.cell(0, 1).text = "Results"
        table.cell(1, 0).text = "Term"
        table.cell(1, 1).text = "Score"
        table.cell(2, 0).text = "Access"
        table.cell(2, 1).text = "10"
        for row in table.rows[:2]:
            marker = OxmlElement("w:tblHeader")
            marker.set(qn("w:val"), "true")
            row._tr.get_or_add_trPr().append(marker)
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "multi-header.docx", "docx")
        table_block = next(block for block in result["blocks"] if block["type"] == "table")
        self.assertEqual(table_block["header_rows"], 2)

    def test_docx_merged_table_cells_preserve_spans_without_repeating_values(self):
        document = Document()
        table = document.add_table(rows=3, cols=3)
        table.cell(0, 0).merge(table.cell(0, 1)).text = "Wide heading"
        table.cell(1, 0).merge(table.cell(2, 0)).text = "Merged row label"
        buffer = io.BytesIO()
        document.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "merged-spans.docx", "docx")
        table_block = next(block for block in result["blocks"] if block["type"] == "table")
        self.assertEqual(table_block["rows"][0][0], "Wide heading")
        self.assertEqual(table_block["rows"][0][1], "")
        self.assertEqual(table_block["cell_spans"][0][0]["colspan"], 2)
        self.assertEqual(table_block["cell_spans"][1][0]["rowspan"], 2)
        self.assertEqual(table_block["cell_spans"][2][0]["covered_by"], [1, 0])

    def test_docx_footnotes_are_included_in_a_separate_notes_section(self):
        document = Document()
        document.add_paragraph("Main document text.")
        buffer = io.BytesIO()
        document.save(buffer)
        original = buffer.getvalue()
        note_xml = b"""<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
        <w:footnotes xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">
          <w:footnote w:type=\"separator\" w:id=\"0\"><w:p/></w:footnote>
          <w:footnote w:id=\"2\"><w:p><w:r><w:t>Footnote content for the reader.</w:t></w:r></w:p></w:footnote>
        </w:footnotes>"""
        rewritten = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(original)) as source, zipfile.ZipFile(rewritten, "w", zipfile.ZIP_DEFLATED) as target:
            for name in source.namelist():
                target.writestr(name, source.read(name))
            target.writestr("word/footnotes.xml", note_xml)

        result = documents.extract_document(rewritten.getvalue(), "footnotes.docx", "docx")
        self.assertTrue(any(block["type"] == "heading" and block["text"] == "Footnotes" for block in result["blocks"]))
        self.assertTrue(any(block["type"] == "paragraph" and block["text"] == "Note 2: Footnote content for the reader." for block in result["blocks"]))
        self.assertTrue(any("inline positions are not reproduced" in warning for warning in result["warnings"]))

    def test_pptx_bullet_levels_and_speaker_notes_are_preserved(self):
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        slide.shapes.title.text = "Lecture topic"
        textbox = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(5), Inches(1))
        paragraph = textbox.text_frame.paragraphs[0]
        paragraph.text = "Nested point"
        paragraph.level = 1
        slide.notes_slide.notes_text_frame.text = "Explain the key example after the slide."
        buffer = io.BytesIO()
        presentation.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "notes.pptx", "pptx")
        list_item = next(block for block in result["blocks"] if block["type"] == "list_item")
        self.assertEqual(list_item["level"], 1)
        self.assertFalse(list_item["ordered"])
        self.assertTrue(any(block["type"] == "speaker_notes" and "key example" in block["text"] for block in result["blocks"]))
        self.assertTrue(any("presenter-only information" in warning for warning in result["warnings"]))

    def test_pptx_merged_table_cells_preserve_grid_spans(self):
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        shape = slide.shapes.add_table(2, 3, Inches(1), Inches(2), Inches(5), Inches(2))
        table = shape.table
        table.cell(0, 0).merge(table.cell(0, 1))
        table.cell(0, 0).text = "Merged cell"
        table.cell(0, 2).merge(table.cell(1, 2))
        table.cell(0, 2).text = "Vertical cell"
        buffer = io.BytesIO()
        presentation.save(buffer)

        result = documents.extract_document(buffer.getvalue(), "merged.pptx", "pptx")
        table_block = next(block for block in result["blocks"] if block["type"] == "table")
        self.assertEqual(table_block["rows"][0][0], "Merged cell")
        self.assertEqual(table_block["cell_spans"][0][0]["colspan"], 2)
        self.assertEqual(table_block["cell_spans"][0][1]["covered_by"], [0, 0])
        self.assertEqual(table_block["cell_spans"][0][2]["rowspan"], 2)
        self.assertEqual(table_block["cell_spans"][1][2]["covered_by"], [0, 2])

    def test_pdf_extraction_requests_layout_aware_text_order(self):
        calls = []
        class FakePage:
            def extract_text(self, **kwargs):
                calls.append(kwargs)
                return "A sufficiently long page of selectable text for layout extraction testing."
        class FakeReader:
            is_encrypted = False
            pages = [FakePage()]
            trailer = {}
        with patch.object(documents, "PdfReader", return_value=FakeReader()), patch.object(documents, "_pdf_tag_warning", return_value=None):
            blocks, warnings, page_count, method = documents._pdf_blocks(b"%PDF-test")
        self.assertEqual(calls, [{"extraction_mode": "layout"}])
        self.assertEqual(page_count, 1)
        self.assertEqual(method, "pypdf")
        self.assertTrue(any("Complex multi-column layouts" in warning for warning in warnings))
        self.assertTrue(any(block["type"] == "paragraph" for block in blocks))

    def test_pdf_extraction_falls_back_when_layout_mode_is_unavailable(self):
        calls = []
        class FakePage:
            def extract_text(self, **kwargs):
                calls.append(kwargs)
                if kwargs:
                    raise TypeError("layout mode unsupported")
                return "A sufficiently long page of selectable text using the fallback extraction path."
        class FakeReader:
            is_encrypted = False
            pages = [FakePage()]
            trailer = {}
        with patch.object(documents, "PdfReader", return_value=FakeReader()), patch.object(documents, "_pdf_tag_warning", return_value=None):
            blocks, warnings, _, _ = documents._pdf_blocks(b"%PDF-test")
        self.assertEqual(calls, [{"extraction_mode": "layout"}, {}])
        self.assertTrue(any("page layout could not be fully preserved" in warning for warning in warnings))
        self.assertTrue(any(block.get("text", "").startswith("A sufficiently long page") for block in blocks))

    def test_table_truncation_respects_character_limit_including_separators(self):
        with patch.object(documents, "MAX_EXTRACTED_TEXT_CHARS", 12):
            result = documents._finalize([
                documents._table_block([["aa", "bb"], ["cc", "dd"]], "Small table")
            ], [], "test")
        self.assertLessEqual(len(result["text"]), 12)
        self.assertTrue(result["truncated"])


if __name__ == "__main__":
    unittest.main()
