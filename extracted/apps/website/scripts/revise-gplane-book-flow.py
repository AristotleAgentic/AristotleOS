from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re
import shutil
import sys
import tempfile

from lxml import etree


source = Path(sys.argv[1])
target = Path(sys.argv[2])
shutil.copyfile(source, target)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC = "http://purl.org/dc/elements/1.1/"
NS = {"w": W}


def w(tag):
    return f"{{{W}}}{tag}"


def qn(ns, tag):
    return f"{{{ns}}}{tag}"


def el(tag, attrs=None, text=None):
    node = etree.Element(w(tag))
    if attrs:
        for key, value in attrs.items():
            node.set(w(key), str(value))
    if text is not None:
        node.text = text
    return node


def paragraph_text(p):
    return "".join(t.text or "" for t in p.findall(".//w:t", namespaces=NS)).strip()


def paragraph_style(p):
    pstyle = p.find("./w:pPr/w:pStyle", namespaces=NS)
    return pstyle.get(w("val")) if pstyle is not None else "Normal"


def set_paragraph_text(p, text, *, size=22, bold=False, color=None):
    ppr = p.find("./w:pPr", namespaces=NS)
    for child in list(p):
        if child is not ppr:
            p.remove(child)
    if ppr is None:
        ppr = el("pPr")
        p.insert(0, ppr)
    r = el("r")
    rpr = el("rPr")
    if bold:
        rpr.append(el("b"))
    if color:
        rpr.append(el("color", {"val": color}))
    rpr.append(el("sz", {"val": size}))
    rpr.append(el("szCs", {"val": size}))
    r.append(rpr)
    t = el("t")
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t.text = text
    r.append(t)
    p.append(r)


def normalized(text):
    text = re.sub(r"\s+", " ", text or "").strip()
    text = text.replace(
        "It matters legally. It matters politically. It matters socially.",
        "The distinction carries legal, political, and social force.",
    )
    text = text.replace("It matters legally.", "The legal consequences are real.")
    text = text.replace("It matters politically.", "The political consequences are real.")
    text = text.replace("It matters socially.", "The social consequences are real.")
    text = text.replace(
        "This publication wrapper preserves that manuscript content and adds the notices needed for circulation as a book-length research artifact.",
        "This publication package preserves the manuscript and gives it the front matter a serious book needs before it circulates beyond draft form.",
    )
    return text


front_matter = {
    "Publication Notices": [
        "Publication Notices",
        "Copyright (c) 2026 J. D. \"Pepper\" Petersen. All rights reserved. This publication is issued by Aristotle Agentic as a research and governance-architecture work concerning autonomous systems, institutional authority, warrants, wards, evidence ledgers, governance kernels, and execution control.",
        "The work is provided for research, education, policy, technical, and institutional discussion. It should not be treated as legal, financial, engineering-safety, procurement, export-control, aviation, insurance, or regulatory-compliance advice. Institutions applying these ideas should obtain appropriate professional review for their own legal duties, operating environments, and risk posture.",
        "No part of this publication may be reproduced, stored in a retrieval system, or transmitted in any form or by any means without prior written permission, except for brief quotations, citation, scholarship, review, or other uses permitted by law. AristotleOS and related governance-plane terminology may appear as research terms, marks, project names, or product identifiers of their respective owners.",
        "No ISBN or Library of Congress Control Number has been assigned to this edition. Suggested citation: Petersen, J. D. \"Pepper\". The G-Plane Architecture: Governance Infrastructure for Autonomous Systems. Aristotle Agentic, Publication Edition, 2026. Contact: Aristotle Agentic, Helena, Montana. Website: aristotleagentic.com.",
    ],
    "Author's Note on Scope": [
        "Author's Note on Scope",
        "This book begins from a practical concern that has followed autonomous systems from the field into public institutions: action is moving faster than the structures that authorize it. A system that can sense, decide, coordinate, and act at machine speed cannot be governed only by after-the-fact policy, paper controls, or human review that arrives after consequence.",
        "The G-Plane is my attempt to describe a runtime architecture for that problem. The question is not whether autonomous systems can act. The question is how human authority remains present inside action itself: who may authorize it, where authority stops, what evidence survives, how escalation works, and how an institution can later explain what happened without pretending the machine was sovereign.",
        "This publication edition keeps the manuscript body intact while adding the front matter needed for circulation as a coherent book-length research artifact. The language has been formatted for readability, but the argument remains the same: governance must become operational architecture before autonomous consequence becomes ordinary infrastructure.",
    ],
    "Publication Contents": [
        "Publication Contents",
        "The manuscript contains its own detailed table of contents and chapter structure. This opening section is only a reader's guide to the publication package: the notices and scope note come first, followed by the manuscript body, foreword, introduction, and the major parts on foundations, authority artifacts, evidence and institutional memory, operational realization, and appendices.",
        "Read as a whole, the book moves from the control problem to the governance gap, then into the mechanisms of wards, warrants, authority envelopes, evidence ledgers, commit-point enforcement, interdomain routing, degraded-connectivity continuity, and the institutional trust needed for insurable autonomy.",
    ],
    "Manuscript": [
        "Manuscript",
        "The manuscript begins on the following page.",
    ],
}


def replace_front_matter(body):
    direct = [child for child in body if child.tag == w("p")]
    for heading, new_texts in front_matter.items():
        direct = [child for child in body if child.tag == w("p")]
        start = next((i for i, p in enumerate(direct) if paragraph_text(p) == heading), None)
        if start is None:
            continue
        end = None
        for j in range(start + 1, len(direct)):
            text = paragraph_text(direct[j])
            if heading == "Publication Contents" and text == "Manuscript":
                end = j
                break
            if heading != "Publication Contents" and text in front_matter and text != heading:
                end = j
                break
            if heading == "Manuscript" and paragraph_style(direct[j]).startswith("Heading"):
                end = j
                break
        if end is None:
            continue
        keep = direct[start:end]
        for idx, text in enumerate(new_texts):
            if idx >= len(keep):
                break
            set_paragraph_text(keep[idx], text, size=34 if idx == 0 else 22, bold=(idx == 0), color="1F3A2D" if idx == 0 else None)
        for p in keep[len(new_texts):]:
            body.remove(p)


def is_body_paragraph(p):
    text = paragraph_text(p)
    if not text:
        return False
    style = paragraph_style(p)
    if style.startswith("Heading") or style.startswith("Compact") or style.startswith("List"):
        return False
    if "Caption" in style:
        return False
    if re.match(r"^(Part|Chapter|Appendix)\s+[IVXLCDM0-9A-Z]+$", text, re.I):
        return False
    if text.endswith(":") and len(text) < 80:
        return False
    return style in {"BodyText", "Body Text", "FirstParagraph", "First Paragraph", "Normal"} or "Body" in style


def should_flush(texts, next_text):
    current = " ".join(texts)
    if len(current) >= 640:
        return True
    if len(current) >= 390 and re.search(r"[.!?]$", current) and len(next_text) > 220:
        return True
    return False


def merge_body_paragraphs(body):
    children = list(body)
    p_nodes = [child for child in children if child.tag == w("p")]
    foreword = next((p for p in p_nodes if paragraph_text(p) == "Foreword" and paragraph_style(p).startswith("Heading")), None)
    if foreword is None:
        return
    started = False
    i = 0
    children = list(body)
    while i < len(children):
        node = children[i]
        if node is foreword:
            started = True
            i += 1
            continue
        if not started or node.tag != w("p") or not is_body_paragraph(node):
            i += 1
            continue

        run = [node]
        texts = [normalized(paragraph_text(node))]
        j = i + 1
        while j < len(children):
            candidate = children[j]
            if candidate.tag != w("p") or not is_body_paragraph(candidate):
                break
            candidate_text = normalized(paragraph_text(candidate))
            if should_flush(texts, candidate_text):
                break
            run.append(candidate)
            texts.append(candidate_text)
            j += 1

        set_paragraph_text(run[0], normalized(" ".join(texts)), size=22)
        for extra in run[1:]:
            body.remove(extra)
            children.remove(extra)
        i += 1


def update_core(work):
    core_path = work / "docProps" / "core.xml"
    if not core_path.exists():
        return
    root = etree.parse(str(core_path)).getroot()
    values = {
        (DC, "title"): "The G-Plane Architecture: Governance Infrastructure for Autonomous Systems",
        (DC, "creator"): "J. D. \"Pepper\" Petersen",
        (DC, "subject"): "Governance infrastructure for autonomous systems",
        (CP, "keywords"): "G-Plane, governance plane, autonomous systems, wards, warrants, authority routing, evidence ledgers, Aristotle Agentic",
        (DC, "description"): "Flow-edited publication package. Headings, lists, and manuscript sequence preserved.",
        (CP, "lastModifiedBy"): "Aristotle Agentic",
    }
    for (ns, tag), value in values.items():
        found = root.find(f".//{{{ns}}}{tag}")
        if found is None:
            found = etree.SubElement(root, qn(ns, tag))
        found.text = value
    core_path.write_bytes(etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes"))


with tempfile.TemporaryDirectory() as td:
    work = Path(td)
    with ZipFile(target, "r") as zin:
        zin.extractall(work)
    document_path = work / "word" / "document.xml"
    tree = etree.parse(str(document_path))
    body = tree.find(".//w:body", namespaces=NS)
    replace_front_matter(body)
    merge_body_paragraphs(body)
    tree.write(str(document_path), xml_declaration=True, encoding="UTF-8", standalone=True)
    update_core(work)
    tmp = target.with_suffix(".tmp.docx")
    if tmp.exists():
        tmp.unlink()
    with ZipFile(tmp, "w", ZIP_DEFLATED) as zout:
        for path in work.rglob("*"):
            if path.is_file():
                zout.write(path, path.relative_to(work).as_posix())
    shutil.move(str(tmp), str(target))

print(target)
