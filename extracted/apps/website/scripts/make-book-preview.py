from docx import Document
from html import escape
from pathlib import Path


src = Path(r"C:\Users\Pepper\Downloads\AristotleOS-github\extracted\apps\website\dist\book\The-G-Plane-Architecture-Book-Package-Flow-Edited.docx")
out = Path(r"C:\Users\Pepper\Downloads\AristotleOS-github\extracted\apps\website\dist\book\The-G-Plane-Architecture-Book-Package-Flow-Edited-preview.html")

doc = Document(str(src))
paras = []
for index, paragraph in enumerate(doc.paragraphs):
    text = paragraph.text.strip()
    if not text:
        continue
    style = paragraph.style.name if paragraph.style else "Normal"
    paras.append((index, style, text))
    if text == "The problem is whether:":
        break

html = [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>G-Plane Book Preview</title>",
    "<style>",
    "body{margin:0;background:#f6f1e8;color:#191714;font-family:Georgia,serif}",
    ".page{max-width:820px;margin:0 auto;padding:64px 28px 96px}",
    ".k{font:700 12px Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#7a5a20;margin-bottom:24px}",
    ".title{font-size:44px;line-height:1.02;color:#17352b;margin:80px 0 10px;text-align:center}",
    ".subtitle{text-align:center;color:#5b625d;font-size:20px;font-style:italic}",
    ".by{text-align:center;margin:40px 0 80px;font-size:18px}",
    ".h1{font-size:30px;color:#17352b;margin:54px 0 16px}",
    ".h2{font-size:22px;color:#315947;margin:34px 0 12px}",
    ".h3{font-size:18px;color:#52675c;margin:24px 0 10px}",
    ".p{font-size:19px;line-height:1.72;margin:0 0 22px}",
    ".file{position:sticky;top:0;background:rgba(246,241,232,.94);border-bottom:1px solid #ded5c8;padding:12px 28px;font:14px Arial,sans-serif;z-index:1}",
    ".file a{color:#17352b;font-weight:700}",
    "</style>",
    "</head>",
    "<body>",
    f'<div class="file"><a href="{src.as_uri()}">Open the DOCX in Word</a> &nbsp; Previewing the opening of the flow-edited book package.</div>',
    '<main class="page">',
    '<div class="k">Publication preview</div>',
]

for _, style, text in paras[:95]:
    cls = "p"
    if text == "THE G-PLANE ARCHITECTURE":
        cls = "title"
    elif style.startswith("Heading 1") or text in {
        "Publication Notices",
        "Author's Note on Scope",
        "Publication Contents",
        "Manuscript",
        "Foreword",
        "Introduction",
    }:
        cls = "h1"
    elif style.startswith("Heading 2"):
        cls = "h2"
    elif style.startswith("Heading 3"):
        cls = "h3"
    elif "Publication Edition" in text or text == "Aristotle Agentic":
        cls = "subtitle"
    elif text.startswith("J. D."):
        cls = "by"
    html.append(f'<p class="{cls}">{escape(text)}</p>')

html += ["</main>", "</body>", "</html>"]
out.write_text("\n".join(html), encoding="utf-8")
print(out)
