"""Pure-function module: small text utilities that call each other.

Try searching for: normalize, word_counts, top_words, text
"""

import re
from collections import Counter

STOP_WORDS = {"the", "a", "an", "and", "of", "to", "in"}


def normalize(text: str) -> str:
    """Lowercase and strip punctuation."""
    lowered = text.lower()
    return re.sub(r"[^a-z\s]", "", lowered)


def tokenize(text: str) -> list[str]:
    cleaned = normalize(text)
    words = cleaned.split()
    return [w for w in words if w not in STOP_WORDS]


def word_counts(text: str) -> Counter:
    tokens = tokenize(text)
    return Counter(tokens)


def top_words(text: str, n: int = 3) -> list[tuple[str, int]]:
    counts = word_counts(text)
    return counts.most_common(n)


def reading_time(text: str, words_per_minute: int = 200) -> float:
    tokens = tokenize(text)
    minutes = len(tokens) / words_per_minute
    return round(minutes, 2)


def report(text: str) -> str:
    best = top_words(text, n=5)
    minutes = reading_time(text)
    lines = [f"{word}: {count}" for word, count in best]
    lines.append(f"~{minutes} min read")
    return "\n".join(lines)


if __name__ == "__main__":
    sample = "The quick brown fox jumps over the lazy dog. The dog sleeps."
    print(report(sample))
