"""Unit tests for Voxora's bounded, structured document extraction."""

import io
import unittest
from unittest.mock import patch

from docx import Document
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
        self.assertTrue(any("do not reliably identify" in warning for warning in result["warnings"]))
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
        self.assertTrue(any("does not infer column headings" in warning for warning in result["warnings"]))

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
        self.assertTrue(any("does not expose reliable semantic header metadata" in warning for warning in result["warnings"]))

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
        self.assertTrue(any("tagged-PDF" in warning for warning in result["warnings"]))
        self.assertEqual(result["status"], "partial")

    def test_pdf_tag_structure_is_not_mistaken_for_a_full_accessibility_check(self):
        result = documents.extract_document(
            make_pdf(["Tagged PDF content has enough selectable text for this test."], tagged=True),
            "tagged.pdf",
            "pdf",
        )
        self.assertTrue(any("does not read its tag tree" in warning for warning in result["warnings"]))

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
                self.assertTrue(any("may be flattened" in warning for warning in result["warnings"]))

    def test_oversized_tables_are_truncated_with_an_accessibility_warning(self):
        rows = [["Column A", "Column B"]] + [[str(index), "Value"] for index in range(documents.MAX_TABLE_ROWS + 1)]
        block = documents._table_block(rows, "Large table", header_rows=1)
        result = documents._finalize([block], [], "test")
        self.assertEqual(len(block["rows"]), documents.MAX_TABLE_ROWS)
        self.assertTrue(block["truncated_rows"])
        self.assertEqual(result["status"], "partial")
        self.assertTrue(any("limited to the first" in warning for warning in result["warnings"]))

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
        self.assertTrue(any("OCR is not installed" in warning for warning in result["warnings"]))

    def test_extraction_is_bounded_and_reports_truncation(self):
        with patch.object(documents, "MAX_EXTRACTED_TEXT_CHARS", 32):
            result = documents.extract_document(("word " * 30).encode(), "long.txt", "txt")
        self.assertLessEqual(len(result["text"]), 32)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["status"], "partial")
        self.assertTrue(any("limited to" in warning for warning in result["warnings"]))

    def test_corrupt_docx_is_reported_without_discarding_original_upload(self):
        result = documents.extract_document(b"not a Word file", "broken.docx", "docx")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["method"], "error")
        self.assertTrue(any("original upload is retained" in warning for warning in result["warnings"]))

    def test_open_document_formats_require_successful_libreoffice_conversion(self):
        result = documents.extract_document(b"document", "notes.odt", "odt")
        self.assertEqual(result["status"], "failed")
        self.assertTrue(any("LibreOffice" in warning for warning in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
