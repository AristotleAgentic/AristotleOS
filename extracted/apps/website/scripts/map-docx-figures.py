import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def para_text(p):
    text = []
    for node in p.iter():
        if node.tag == f"{{{NS['w']}}}t" and node.text:
            text.append(node.text)
    return "".join(text).strip()


def para_embeds(p):
    embeds = []
    for node in p.iter():
        embed = node.attrib.get(f"{{{NS['r']}}}embed")
        if embed:
            embeds.append(embed)
    return embeds


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: map-docx-figures.py <docx>")
        return 2
    path = Path(sys.argv[1])
    with zipfile.ZipFile(path) as zf:
        root = ET.fromstring(zf.read("word/document.xml"))
        body = root.find("w:body", NS)
        paragraphs = body.findall("w:p", NS)
        rel_root = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
        rels = {
            item.attrib["Id"]: item.attrib.get("Target", "")
            for item in rel_root
            if item.attrib.get("Type", "").endswith("/image")
        }

    for idx, paragraph in enumerate(paragraphs):
        embeds = para_embeds(paragraph)
        if not embeds:
            continue
        print(f"paragraph {idx}")
        for rid in embeds:
            print(f"  image {rid}: {rels.get(rid)}")
        for offset in range(-4, 5):
            j = idx + offset
            if j < 0 or j >= len(paragraphs):
                continue
            label = "FIG" if offset == 0 else f"{offset:+d}"
            text = para_text(paragraphs[j])
            if text:
                print(f"  {label}: {text[:240]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
