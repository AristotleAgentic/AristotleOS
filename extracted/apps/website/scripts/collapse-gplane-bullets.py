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


def w(tag):
    return f"{{{W}}}{tag}"


def paragraph_text(p):
    return "".join(t.text or "" for t in p.findall(".//w:t", namespaces=NS)).strip()


def paragraph_style(p):
    pstyle = p.find("./w:pPr/w:pStyle", namespaces=NS)
    return pstyle.get(w("val")) if pstyle is not None else "Normal"


def set_style(p, style_id="BodyText"):
    ppr = p.find("./w:pPr", namespaces=NS)
    if ppr is None:
        ppr = etree.Element(w("pPr"))
        p.insert(0, ppr)
    pstyle = ppr.find("./w:pStyle", namespaces=NS)
    if pstyle is None:
        pstyle = etree.Element(w("pStyle"))
        ppr.insert(0, pstyle)
    pstyle.set(w("val"), style_id)


def set_text(p, text):
    nodes = p.findall(".//w:t", namespaces=NS)
    if not nodes:
        r = etree.Element(w("r"))
        t = etree.Element(w("t"))
        r.append(t)
        p.append(r)
        nodes = [t]
    nodes[0].text = text
    nodes[0].set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    for node in nodes[1:]:
        node.text = ""


def is_compact(p):
    text = paragraph_text(p)
    return paragraph_style(p).startswith("Compact") or text.startswith("• ")


def clean_item(text):
    text = re.sub(r"^[•\\-–—]\\s*", "", text.strip())
    text = text.rstrip(".;:")
    return text


def join_items(items):
    items = [clean_item(item) for item in items if clean_item(item)]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])}, and {items[-1]}"


def prose_from(prev_text, items):
    joined = join_items(items)
    if not joined:
        return prev_text
    if prev_text.endswith(":"):
        return f"{prev_text[:-1]} {joined}."
    if prev_text.endswith("."):
        return f"{prev_text} The relevant elements are {joined}."
    return f"{prev_text} {joined}."


with tempfile.TemporaryDirectory() as td:
    work = Path(td)
    with ZipFile(target, "r") as zin:
        zin.extractall(work)

    document_path = work / "word" / "document.xml"
    tree = etree.parse(str(document_path))
    body = tree.find(".//w:body", namespaces=NS)
    children = list(body)
    collapsed_runs = 0
    removed_paragraphs = 0

    i = 0
    while i < len(children):
        node = children[i]
        if node.tag != w("p") or not is_compact(node):
            i += 1
            continue

        run = []
        j = i
        while j < len(children) and children[j].tag == w("p") and is_compact(children[j]):
            run.append(children[j])
            j += 1

        if len(run) >= 3:
            prev = None
            k = i - 1
            while k >= 0:
                if children[k].tag == w("p") and paragraph_text(children[k]):
                    prev = children[k]
                    break
                k -= 1

            items = [paragraph_text(p) for p in run]
            if prev is not None:
                set_text(prev, prose_from(paragraph_text(prev), items))
                for p in run:
                    body.remove(p)
                    children.remove(p)
                    removed_paragraphs += 1
            else:
                set_text(run[0], f"The relevant elements are {join_items(items)}.")
                set_style(run[0], "BodyText")
                for p in run[1:]:
                    body.remove(p)
                    children.remove(p)
                    removed_paragraphs += 1
            collapsed_runs += 1
            i = max(i - 1, 0)
        else:
            i = j

    tree.write(str(document_path), xml_declaration=True, encoding="UTF-8", standalone=True)

    tmp = target.with_suffix(".tmp.docx")
    if tmp.exists():
        tmp.unlink()
    with ZipFile(tmp, "w", ZIP_DEFLATED) as zout:
        for path in work.rglob("*"):
            if path.is_file():
                zout.write(path, path.relative_to(work).as_posix())
    shutil.move(str(tmp), str(target))

print(f"collapsed_runs={collapsed_runs} removed_paragraphs={removed_paragraphs}")
