"""Script style: top-level code that reads data, computes and prints.

Try searching for: total, average, prices
"""

import statistics

# Raw input as it might come from a file.
raw = "apple:3.5, banana:1.25, cherry:7.0, durian:12.0"

# Split the text into (name, price) pairs.
items = []
for chunk in raw.split(","):
    name, price_text = chunk.strip().split(":")
    items.append((name, float(price_text)))

prices = [price for _, price in items]
total = sum(prices)
average = total / len(prices)
spread = statistics.pstdev(prices)

# Anything more than one standard deviation above the mean is "expensive".
threshold = average + spread
expensive = [name for name, price in items if price > threshold]

summary = f"{len(items)} items, total {total:.2f}, average {average:.2f}"
print(summary)
print("Expensive:", ", ".join(expensive))
