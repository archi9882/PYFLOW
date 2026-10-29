"""Class-based style: a shopping cart with a dataclass and methods.

Try searching for: items, discount_rate, Product.price, checkout
Values stored on ``self`` are tracked as attributes: follow ``price`` from
``checkout`` through ``Cart.add`` into ``self.items`` and out of ``total``.
"""

from dataclasses import dataclass


@dataclass
class Product:
    name: str
    price: float


class Cart:
    def __init__(self, owner: str, discount_rate: float = 0.0):
        self.owner = owner
        self.discount_rate = discount_rate
        self.items = []

    def add(self, product: Product, quantity: int = 1):
        line_total = product.price * quantity
        self.items.append((product, quantity, line_total))
        return line_total

    def subtotal(self) -> float:
        return sum(total for _, _, total in self.items)

    def total(self) -> float:
        base = self.subtotal()
        discount = self.apply_discount(base)
        return base - discount

    def apply_discount(self, amount: float) -> float:
        return amount * self.discount_rate

    @staticmethod
    def format_price(value: float) -> str:
        return f"${value:,.2f}"


def checkout(owner: str, shopping_list: list[tuple[str, float, int]]) -> str:
    cart = Cart(owner, discount_rate=0.1)
    for name, price, qty in shopping_list:
        product = Product(name, price)
        cart.add(product, qty)
    amount = cart.total()
    return Cart.format_price(amount)


print(checkout("Archi", [("pen", 1.5, 4), ("notebook", 3.0, 2)]))
