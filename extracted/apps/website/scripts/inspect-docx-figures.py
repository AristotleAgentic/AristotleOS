import re
import sys
import zipfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: inspect-docx-figures.py <docx>")
        return 2

    docx_path = Path(sys.argv[1])
    with zipfile.ZipFile(docx_path) as zf:
        names = zf.namelist()
        document_xml = zf.read("word/document.xml").decode("utf-8", "ignore")
        rels_xml = ""
        if "word/_rels/document.xml.rels" in names:
            rels_xml = zf.read("word/_rels/document.xml.rels").decode("utf-8", "ignore")

        media = [name for name in names if name.startswith("word/media/")]
        embeds = re.findall(r'r:embed="([^"]+)"', document_xml)
        image_rels = re.findall(r'<Relationship[^>]+Type="[^"]*/image"[^>]+>', rels_xml)
        targets = re.findall(r'Target="media/([^"]+)"', rels_xml)

        print(f"file: {docx_path}")
        print(f"media files: {len(media)}")
        for item in media:
            print(f"  {item}")
        print(f"w:drawing count: {document_xml.count('<w:drawing')}")
        print(f"w:pict count: {document_xml.count('<w:pict')}")
        print(f"embedded relationship ids in body: {len(embeds)}")
        if embeds:
            print("  " + ", ".join(embeds[:40]))
        print(f"image relationships: {len(image_rels)}")
        for rel in image_rels:
            print(f"  {rel}")
        print(f"relationship targets: {len(targets)}")
        if targets:
            print("  " + ", ".join(targets[:40]))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
