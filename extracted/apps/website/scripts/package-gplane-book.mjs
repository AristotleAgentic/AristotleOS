#!/usr/bin/env node
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const python = "C:\\Users\\Pepper\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const source = process.argv[2] ?? "D:\\papers\\Polished_Petersen_GPlane_Architecture_With_Implementation_Appendix_G_FINAL.docx";
const outDir = resolve(appDir, "dist", "book");
const output = resolve(outDir, "The-G-Plane-Architecture-Book-Package.docx");
const helper = resolve(outDir, "insert_frontmatter.py");

mkdirSync(outDir, { recursive: true });
copyFileSync(source, output);

const helperSource = String.raw`
from copy import deepcopy
from datetime import date
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import shutil
import sys
import tempfile
from lxml import etree

docx_path = Path(sys.argv[1])
tmp_path = docx_path.with_suffix(".tmp.docx")

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC = "http://purl.org/dc/elements/1.1/"
DCTERMS = "http://purl.org/dc/terms/"
DCTYPE = "http://purl.org/dc/dcmitype/"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
NS = {"w": W}

def qn(ns, tag):
    return f"{{{ns}}}{tag}"

def w(tag):
    return qn(W, tag)

def elem(tag, attrs=None, text=None):
    node = etree.Element(w(tag))
    if attrs:
        for key, value in attrs.items():
            node.set(w(key), value)
    if text is not None:
        node.text = text
    return node

def paragraph(text="", *, align=None, style=None, size=None, bold=False, italic=False, small_caps=False, color=None, before=None, after=None, line=None):
    p = elem("p")
    pPr = elem("pPr")
    if style:
        pPr.append(elem("pStyle", {"val": style}))
    if align:
        pPr.append(elem("jc", {"val": align}))
    if before is not None or after is not None or line is not None:
        attrs = {}
        if before is not None:
            attrs["before"] = str(before)
        if after is not None:
            attrs["after"] = str(after)
        if line is not None:
            attrs["line"] = str(line)
            attrs["lineRule"] = "auto"
        pPr.append(elem("spacing", attrs))
    p.append(pPr)
    if text:
        r = elem("r")
        rPr = elem("rPr")
        if bold:
            rPr.append(elem("b"))
        if italic:
            rPr.append(elem("i"))
        if small_caps:
            rPr.append(elem("smallCaps"))
        if size:
            rPr.append(elem("sz", {"val": str(int(size * 2))}))
            rPr.append(elem("szCs", {"val": str(int(size * 2))}))
        if color:
            rPr.append(elem("color", {"val": color}))
        r.append(rPr)
        t = elem("t")
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        t.text = text
        r.append(t)
        p.append(r)
    return p

def page_break():
    p = elem("p")
    r = elem("r")
    br = elem("br", {"type": "page"})
    r.append(br)
    p.append(r)
    return p

def blank_line(points=12):
    return paragraph("", after=points * 20)

def publication_contents():
    items = [
        "Publication Notices",
        "Author's Note on Scope",
        "Manuscript Body",
        "Foreword",
        "Introduction",
        "Part I: Foundations of Autonomous Infrastructure Governance",
        "Part II: Authority and Governance Artifacts",
        "Part III: Evidence, Identity, and Institutional Memory",
        "Part IV: Operational Realization",
        "Part V and Appendices: Implementation detail, extended governance patterns, and reference material",
    ]
    nodes = [paragraph("Publication Contents", align="center", size=18, bold=True, color="1F3A2D", after=280)]
    nodes.append(paragraph("The manuscript body contains its own detailed table of contents and chapter structure. This publication wrapper preserves that manuscript content and adds the notices needed for circulation as a book-length research artifact.", size=10.5, color="333333", line=300, after=180))
    for item in items:
        nodes.append(paragraph(item, size=11, color="111111", after=100))
    return nodes

def front_matter():
    today = date.today().strftime("%B %Y")
    nodes = []

    nodes += [
        blank_line(180),
        paragraph("THE G-PLANE ARCHITECTURE", align="center", size=22, bold=True, small_caps=True, color="1F3A2D", after=180),
        paragraph("Governance Infrastructure for Autonomous Systems", align="center", size=13, italic=True, color="5F6F67", after=520),
        paragraph("J. D. \"Pepper\" Petersen", align="center", size=12, color="333333"),
        page_break(),
    ]

    nodes += [
        blank_line(90),
        paragraph("THE G-PLANE ARCHITECTURE", align="center", size=28, bold=True, color="1F3A2D", after=120),
        paragraph("Governance Infrastructure for Autonomous Systems", align="center", size=16, italic=True, color="52675C", after=220),
        paragraph("Including Wards, Warrants, Authority Routing, Evidence Ledgers, Governance Kernels, and Execution Control for Autonomous Infrastructure", align="center", size=11, color="333333", line=300, after=420),
        paragraph("J. D. \"Pepper\" Petersen", align="center", size=15, bold=True, color="111111", after=80),
        paragraph("Aristotle Agentic", align="center", size=12, color="5F6F67", after=640),
        paragraph(f"Publication Edition | {today}", align="center", size=10.5, color="777777"),
        page_break(),
    ]

    notices = [
        "Copyright (c) 2026 J. D. \"Pepper\" Petersen. All rights reserved.",
        "Published by Aristotle Agentic. AristotleOS and related governance-plane terminology are used as marks, project names, research terms, or product identifiers of their respective owners.",
        "No ISBN has been assigned to this edition. No Library of Congress Control Number has been assigned.",
        "This publication is provided for research, education, policy, technical, and institutional discussion. It is not legal, financial, engineering-safety, procurement, export-control, aviation, insurance, or regulatory-compliance advice.",
        "No part of this publication may be reproduced, stored in a retrieval system, or transmitted in any form or by any means without prior written permission, except for brief quotations, citation, scholarship, review, or other uses permitted by law.",
        "Suggested citation: Petersen, J. D. \"Pepper\". The G-Plane Architecture: Governance Infrastructure for Autonomous Systems. Aristotle Agentic, Publication Edition, 2026.",
        "Edition note: This publication edition preserves the manuscript body and adds front matter, publication notices, citation guidance, and book-format packaging.",
        "Contact: Aristotle Agentic, Helena, Montana. Website: aristotleagentic.com.",
    ]
    nodes += [
        paragraph("Publication Notices", size=17, bold=True, color="1F3A2D", after=180),
    ]
    for notice in notices:
        nodes.append(paragraph(notice, size=10.5, color="222222", line=300, after=140))
    nodes.append(page_break())

    nodes += [
        paragraph("Author's Note on Scope", size=17, bold=True, color="1F3A2D", after=180),
        paragraph("This work addresses governance architecture for autonomous and AI-enabled systems. Its central concern is not whether autonomous systems can act, but how action is authorized, constrained, evidenced, escalated, and made accountable to human institutions.", size=11, color="222222", line=320, after=160),
        paragraph("The manuscript body that follows has not been substantively rewritten in this publication package. Front matter has been added so the work can circulate as a coherent book-length research artifact.", size=11, color="222222", line=320, after=160),
        page_break(),
    ]

    nodes += publication_contents()
    nodes.append(page_break())
    nodes += [
        paragraph("Manuscript", align="center", size=18, bold=True, color="1F3A2D", after=240),
        paragraph("The following pages reproduce the manuscript body.", align="center", size=11, italic=True, color="666666", after=240),
        page_break(),
    ]
    return nodes

def update_core(xml):
    root = etree.fromstring(xml)
    nsmap = {"cp": CP, "dc": DC, "dcterms": DCTERMS, "dcmitype": DCTYPE, "xsi": XSI}
    values = {
        (DC, "title"): "The G-Plane Architecture: Governance Infrastructure for Autonomous Systems",
        (DC, "creator"): "J. D. \"Pepper\" Petersen",
        (DC, "subject"): "Governance infrastructure for autonomous systems",
        (CP, "keywords"): "G-Plane, governance plane, autonomous systems, wards, warrants, authority routing, evidence ledgers, Aristotle Agentic",
        (DC, "description"): "Publication edition with front matter and notices. Manuscript body preserved.",
        (CP, "lastModifiedBy"): "Aristotle Agentic",
    }
    for (ns, tag), value in values.items():
        found = root.find(f".//{{{ns}}}{tag}")
        if found is None:
            found = etree.SubElement(root, qn(ns, tag))
        found.text = value
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")

with tempfile.TemporaryDirectory() as td:
    work = Path(td)
    with ZipFile(docx_path, "r") as z:
        z.extractall(work)

    document_xml = work / "word" / "document.xml"
    tree = etree.parse(str(document_xml))
    body = tree.find(".//w:body", namespaces=NS)
    children = list(body)
    insert_at = 0
    for i, child in enumerate(children):
        if child.tag == w("sectPr"):
            insert_at = i
            break
        insert_at = i
        break

    for node in reversed(front_matter()):
        body.insert(insert_at, node)
    tree.write(str(document_xml), xml_declaration=True, encoding="UTF-8", standalone=True)

    core_xml = work / "docProps" / "core.xml"
    if core_xml.exists():
        core_xml.write_bytes(update_core(core_xml.read_bytes()))

    if tmp_path.exists():
        tmp_path.unlink()
    with ZipFile(tmp_path, "w", ZIP_DEFLATED) as zout:
        for path in work.rglob("*"):
            if path.is_file():
                zout.write(path, path.relative_to(work).as_posix())

shutil.move(str(tmp_path), str(docx_path))
print(docx_path)
`;

import { writeFileSync } from "node:fs";
writeFileSync(helper, helperSource, "utf8");
const result = spawnSync(python, [helper, output], { encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
process.stdout.write(`${output}\n`);
