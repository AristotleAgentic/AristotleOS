from base64 import b64encode
from docx import Document
from html import escape
from pathlib import Path
import re
import zipfile


import sys


src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"C:\Users\Pepper\Downloads\AristotleOS-github\extracted\apps\website\dist\book\The-G-Plane-Architecture-Book-Package-Flow-Edited.docx")
out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(r"C:\Users\Pepper\Downloads\AristotleOS-github\extracted\apps\website\dist\book\The-G-Plane-Architecture-Book-Package-Flow-Edited-print.html")

doc = Document(str(src))


def image_lookup(docx_path):
    lookup = {}
    with zipfile.ZipFile(docx_path) as zf:
        names = set(zf.namelist())
        rels_path = "word/_rels/document.xml.rels"
        if rels_path not in names:
            return lookup
        rels = zf.read(rels_path).decode("utf-8", "ignore")
        for rid, target in re.findall(r'<Relationship[^>]+Id="([^"]+)"[^>]+Target="media/([^"]+)"[^>]*/>', rels):
            media_path = f"word/media/{target}"
            if media_path not in names:
                continue
            suffix = Path(target).suffix.lower().lstrip(".") or "png"
            mime = "jpeg" if suffix in {"jpg", "jpeg"} else suffix
            encoded = b64encode(zf.read(media_path)).decode("ascii")
            lookup[rid] = f"data:image/{mime};base64,{encoded}"
    return lookup


def paragraph_embeds(paragraph):
    embeds = []
    for node in paragraph._p.iter():
        embed = node.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
        if embed:
            embeds.append(embed)
    return embeds


images = image_lookup(src)


def cls_for(style, text):
    if style == "Title":
        return "title"
    if style == "Subtitle":
        return "subtitle"
    if text == "THE G-PLANE ARCHITECTURE":
        return "title"
    if text.startswith("Figure 0."):
        return "caption"
    if style.startswith("Heading 1") or text in {
        "Publication Notices",
        "Author's Note on Scope",
        "Publication Contents",
        "Manuscript",
        "Foreword",
        "Introduction",
    }:
        return "h1"
    if style.startswith("Heading 2"):
        return "h2"
    if style.startswith("Heading 3"):
        return "h3"
    if style.startswith("Compact"):
        return "compact"
    if style.startswith("First Paragraph"):
        return "lead"
    if "Publication Edition" in text or text == "Aristotle Agentic":
        return "subtitle"
    if text.startswith("J. D."):
        return "by"
    return "p"


html = [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    "<title>The G-Plane Architecture</title>",
    "<style>",
    "@page{size:letter;margin:0.78in 0.86in 0.82in}",
    "body{margin:0;background:white;color:#171512;font-family:Georgia,'Times New Roman',serif}",
    ".book{max-width:7in;margin:0 auto}",
    ".title{text-align:center;font-size:34pt;line-height:1.08;color:#17352b;margin:2.15in 0 .2in;font-weight:700;letter-spacing:.01em}",
    ".subtitle{text-align:center;color:#5b625d;font-size:15pt;font-style:italic;margin:.1in 0 .18in}",
    ".by{text-align:center;margin:.35in 0 .7in;font-size:13pt}",
    ".h1{break-after:avoid;font-size:20pt;line-height:1.15;color:#17352b;margin:.42in 0 .16in;font-weight:700}",
    ".h2{break-after:avoid;font-size:15pt;line-height:1.2;color:#315947;margin:.28in 0 .1in;font-weight:700}",
    ".h3{break-after:avoid;font-size:12.5pt;line-height:1.2;color:#52675c;margin:.2in 0 .08in;font-weight:700}",
    ".p,.lead{font-size:11.2pt;line-height:1.52;margin:0 0 .12in;text-align:left}",
    ".lead{font-size:11.6pt}",
    ".compact{font-size:10.8pt;line-height:1.35;margin:0 0 .055in .25in}",
    ".compact:before{content:'• ';color:#7a5a20}",
    ".figure{break-inside:avoid;text-align:center;margin:.18in 0 .04in}",
    ".figure img{display:block;max-width:100%;max-height:8.4in;margin:0 auto;object-fit:contain}",
    ".caption{break-after:avoid;text-align:center;color:#465850;font-size:9.6pt;line-height:1.35;font-style:italic;margin:.04in .28in .2in}",
    ".pagebreak{break-after:page;height:0}",
    "p{orphans:3;widows:3}",
    "</style>",
    "</head>",
    "<body><main class=\"book\">",
]

for paragraph in doc.paragraphs:
    embeds = paragraph_embeds(paragraph)
    for rid in embeds:
        src_data = images.get(rid)
        if src_data:
            html.append(f'<div class="figure"><img src="{src_data}" alt="Book figure"></div>')
    text = paragraph.text.strip()
    if not text:
        continue
    style = paragraph.style.name if paragraph.style else "Normal"
    html.append(f'<p class="{cls_for(style, text)}">{escape(text)}</p>')
    if text == "Aristotle Agentic Publication Edition | June 2026":
        html.append('<div class="pagebreak"></div>')

html += ["</main></body></html>"]
out.write_text("\n".join(html), encoding="utf-8")
print(out)
