from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re
import shutil
import sys
import tempfile

from lxml import etree


target = Path(sys.argv[1])
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def paragraph_text(p):
    return "".join(t.text or "" for t in p.findall(".//w:t", namespaces=NS))


def set_paragraph_text(p, text):
    text_nodes = p.findall(".//w:t", namespaces=NS)
    if not text_nodes:
        return
    text_nodes[0].text = text
    for node in text_nodes[1:]:
        node.text = ""


def replacement(text):
    original = text

    # Short list entries such as "patient safety matters" read better as stakes.
    stripped = text.strip()
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9 ,;:'\"\\-–—/]+ matters", stripped):
        return text.replace(stripped, stripped[:-8] + " is at stake")

    specific = {
        "This distinction matters because": "This distinction is consequential because",
        "That distinction matters because": "That distinction is consequential because",
        "This distinction between policy and architecture matters enormously.": "This distinction between policy and architecture carries enormous consequence.",
        "This expansion matters because": "This expansion is consequential because",
        "This matters because": "This is consequential because",
        "This formalization matters because": "This formalization is consequential because",
        "That question matters, but": "That question is important, but",
        "Governability matters most precisely when": "Governability is most urgent precisely when",
        "This framing matters.": "This framing carries weight.",
        "This matters commercially.": "This carries commercial consequence.",
        "That phrase matters.": "That phrase carries weight.",
        "This phrase matters.": "This phrase carries weight.",
        "This realization matters.": "This realization carries consequence.",
        "This behavior matters.": "This behavior carries consequence.",
        "These mechanisms matter.": "These mechanisms remain necessary.",
        "This difference matters.": "This difference is decisive.",
        "Governance ultimately matters only if": "Governance has force only if",
        "Governance ultimately matters most precisely where": "Governance has the greatest force precisely where",
        "This distinction matters profoundly.": "This distinction carries profound consequence.",
        "That distinction matters.": "That distinction is decisive.",
        "That distinction matters enormously.": "That distinction carries enormous consequence.",
        "This distinction matters enormously.": "This distinction carries enormous consequence.",
        "This distinction matters.": "This distinction is decisive.",
        "This matters.": "This carries consequence.",
        "What matters": "What counts",
        "what matters": "what counts",
    }
    for old, new in specific.items():
        text = text.replace(old, new)

    # Final safety net for any remaining standalone word.
    text = re.sub(r"\bmatters\b", "carries consequence", text, flags=re.IGNORECASE)
    return text if text != original else original


with tempfile.TemporaryDirectory() as td:
    work = Path(td)
    with ZipFile(target, "r") as zin:
        zin.extractall(work)
    document_path = work / "word" / "document.xml"
    tree = etree.parse(str(document_path))
    changed = 0
    for p in tree.findall(".//w:p", namespaces=NS):
        text = paragraph_text(p)
        if re.search(r"\bmatters\b", text, re.IGNORECASE):
            new_text = replacement(text)
            set_paragraph_text(p, new_text)
            changed += 1
    tree.write(str(document_path), xml_declaration=True, encoding="UTF-8", standalone=True)

    tmp = target.with_suffix(".tmp.docx")
    if tmp.exists():
        tmp.unlink()
    with ZipFile(tmp, "w", ZIP_DEFLATED) as zout:
        for path in work.rglob("*"):
            if path.is_file():
                zout.write(path, path.relative_to(work).as_posix())
    shutil.move(str(tmp), str(target))

print(f"updated {changed} paragraph(s)")
