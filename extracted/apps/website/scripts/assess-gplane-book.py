from collections import Counter
from pathlib import Path
import re
import sys

from docx import Document


ROOT = Path(__file__).resolve().parents[1]
DOCX = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "book" / "The-G-Plane-Architecture-Scientific-Edition.docx"

PATTERNS = [
    "governance must",
    "autonomous systems",
    "machine speed",
    "before consequence",
    "constitutional",
    "runtime",
    "admissibility",
    "authority",
    "institutional",
    "evidence ledger",
    "warrant",
    "ward",
]


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z'-]*", text.lower())


def main() -> None:
    doc = Document(str(DOCX))
    paragraphs = [p for p in doc.paragraphs if p.text.strip()]
    text = "\n".join(p.text.strip() for p in paragraphs)
    word_list = words(text)

    print(f"paragraphs: {len(paragraphs)}")
    print(f"words: {len(word_list)}")
    print(f"headings: {sum(1 for p in paragraphs if p.style.name.startswith('Heading'))}")
    print()

    print("pattern counts")
    lower = text.lower()
    for pattern in PATTERNS:
        print(f"{pattern}: {lower.count(pattern)}")
    print()

    print("most common 2-grams/3-grams excluding light words")
    stop = set("the of and to a in that is for as by with it this into from be at on or an where who how what not can must".split())
    filtered = [w for w in word_list if w not in stop and len(w) > 2]
    for n in [2, 3]:
        grams = Counter(tuple(filtered[i:i+n]) for i in range(len(filtered) - n + 1))
        for gram, count in grams.most_common(20):
            if count >= 10:
                print(count, " ".join(gram))
        print()

    print("chapter title clusters")
    titles = []
    current_chapter = None
    for p in paragraphs:
        t = p.text.strip()
        if re.fullmatch(r"Chapter \d+", t):
            current_chapter = t
        elif current_chapter and p.style.name.startswith("Heading 1"):
            titles.append((current_chapter, t))
            current_chapter = None
    for chapter, title in titles:
        print(f"{chapter}: {title}")


if __name__ == "__main__":
    main()
