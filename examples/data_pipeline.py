"""Data-processing pipeline: load -> clean -> transform -> aggregate -> report.

Try searching for: records, clean, by_city, rows
It also contains constructs pyflow reports as unsupported:
a decorator that may change the signature, *args, and getattr().
"""

import csv
import io
import time

RAW_CSV = """city,temp_c,humidity
Taipei,28.5,80
Taichung,30.1,65
Kaohsiung,31.0,
Taipei,27.9,82
"""


def timed(func):
    """Decorator that prints how long a step took."""
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        value = func(*args, **kwargs)
        print(f"{func.__name__}: {time.perf_counter() - start:.4f}s")
        return value
    return wrapper


def load(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


def clean(rows: list[dict]) -> list[dict]:
    kept = []
    for row in rows:
        if not row["humidity"]:
            continue
        kept.append(row)
    return kept


def to_numbers(rows: list[dict]) -> list[tuple[str, float, float]]:
    return [(r["city"], float(r["temp_c"]), float(r["humidity"])) for r in rows]


@timed
def aggregate(records):
    by_city = {}
    for city, temp, humidity in records:
        totals = by_city.setdefault(city, [0.0, 0.0, 0])
        totals[0] += temp
        totals[1] += humidity
        totals[2] += 1
    return {city: (t / n, h / n) for city, (t, h, n) in by_city.items()}


def render(summary: dict, *columns) -> str:
    fmt = getattr(str, "ljust")
    lines = [fmt(city, 10) + f"{temp:5.1f}C {hum:4.0f}%" for city, (temp, hum) in summary.items()]
    return "\n".join(lines)


def run_pipeline(text: str = RAW_CSV) -> str:
    rows = load(text)
    rows = clean(rows)
    records = to_numbers(rows)
    summary = aggregate(records)
    return render(summary, "temp", "humidity")


if __name__ == "__main__":
    print(run_pipeline())
