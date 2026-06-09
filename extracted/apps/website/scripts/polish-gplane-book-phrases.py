from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import shutil
import sys
import tempfile

from lxml import etree


target = Path(sys.argv[1])
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def paragraph_text(p):
    return "".join(t.text or "" for t in p.findall(".//w:t", namespaces=NS))


def replace_text_in_paragraph(p, old, new):
    text = paragraph_text(p)
    if old not in text:
        return False
    # The flow-edited paragraphs are single-run in the affected body text, so this
    # direct replacement preserves the document structure without touching headings.
    first = p.find(".//w:t", namespaces=NS)
    for t in p.findall(".//w:t", namespaces=NS):
        t.text = ""
    if first is not None:
        first.text = text.replace(old, new)
    return True


with tempfile.TemporaryDirectory() as td:
    work = Path(td)
    with ZipFile(target, "r") as zin:
        zin.extractall(work)
    document_path = work / "word" / "document.xml"
    tree = etree.parse(str(document_path))
    replacements = {
        "These discussions matter. They are also incomplete.": "Those discussions are necessary, but incomplete.",
        "These discussions matter. They remain incomplete. The critical governance problem emerges after cognition. The governance problem emerges at execution. This distinction shaped the entire architecture.": "Those discussions are necessary, but they do not reach the decisive point. The hardest governance problem appears after cognition, when a decision becomes execution, and that distinction shaped the entire architecture.",
        "This distinction becomes critically important": "That distinction becomes decisive",
    }
    count = 0
    for p in tree.findall(".//w:p", namespaces=NS):
        for old, new in replacements.items():
            if replace_text_in_paragraph(p, old, new):
                count += 1
    tree.write(str(document_path), xml_declaration=True, encoding="UTF-8", standalone=True)
    tmp = target.with_suffix(".tmp.docx")
    if tmp.exists():
        tmp.unlink()
    with ZipFile(tmp, "w", ZIP_DEFLATED) as zout:
        for path in work.rglob("*"):
            if path.is_file():
                zout.write(path, path.relative_to(work).as_posix())
    shutil.move(str(tmp), str(target))

print(f"updated {count} phrase(s) in {target}")
