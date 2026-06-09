from __future__ import annotations

from collections import Counter
from pathlib import Path
import math
import re
import sys

from docx import Document


ROOT = Path(__file__).resolve().parents[1]
DOCX = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "book" / "The-G-Plane-Architecture-Final-Candidate.docx"

STOP = set(
    """
    the of and to a in that is for as by with it this into from be at on or an where who how what not can
    must may should under through across inside outside before after itself themselves therefore because
    remains remain become becomes becoming system systems architecture plane governance gplane
    """.split()
)


def words(text: str) -> list[str]:
    return [
        w
        for w in re.findall(r"[A-Za-z][A-Za-z'-]*", text.lower())
        if len(w) > 2 and w not in STOP
    ]


def cosine(a: Counter[str], b: Counter[str]) -> float:
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    if not dot:
        return 0.0
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb)


def section_blocks(doc: Document):
    paragraphs = doc.paragraphs
    blocks = []
    current = None
    chapter = None
    for i, paragraph in enumerate(paragraphs):
        text = paragraph.text.strip()
        if not text:
            continue
        style = paragraph.style.name if paragraph.style else ""
        if re.fullmatch(r"Chapter \d+", text):
            chapter = text
            continue
        if style.startswith("Heading 1") and text not in {"Part I", "Part II", "Part III", "Part IV", "Part V", "Part VI", "Part VII"}:
            if current:
                blocks.append(current)
            title = f"{chapter + ': ' if chapter else ''}{text}"
            current = {"title": title, "start": i, "texts": []}
            chapter = None
            continue
        if current and not style.startswith("Heading"):
            current["texts"].append(text)
    if current:
        blocks.append(current)
    for block in blocks:
        block["text"] = " ".join(block["texts"])
        block["counter"] = Counter(words(block["text"]))
        block["word_count"] = len(words(block["text"]))
    return blocks


def repeated_phrases(blocks):
    all_text = "\n".join(block["text"] for block in blocks)
    tokenized = words(all_text)
    for n in (4, 5, 6, 7):
        grams = Counter(tuple(tokenized[i : i + n]) for i in range(len(tokenized) - n + 1))
        common = [(" ".join(k), v) for k, v in grams.most_common(40) if v >= 8]
        print(f"\nRepeated {n}-grams")
        for phrase, count in common[:25]:
            print(f"{count:>3}  {phrase}")


def main():
    doc = Document(str(DOCX))
    blocks = [b for b in section_blocks(doc) if b["word_count"] > 80]
    print(f"Document: {DOCX}")
    print(f"Blocks: {len(blocks)}")

    pairs = []
    for i, a in enumerate(blocks):
        for b in blocks[i + 1 :]:
            score = cosine(a["counter"], b["counter"])
            if score >= 0.47:
                pairs.append((score, a, b))
    pairs.sort(reverse=True, key=lambda x: x[0])
    print("\nHighest section similarities")
    for score, a, b in pairs[:40]:
        print(f"{score:.3f} | {a['title']} [{a['start']}] <-> {b['title']} [{b['start']}]")

    repeated_phrases(blocks)


if __name__ == "__main__":
    main()
