import { randomBytes } from "crypto";
import type { Coupon, Product } from "./types";

/* First-run data: the quick-bites menu and one example coupon.
   Everything here is editable from /admin. */

const U = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=640&q=75`;

type P = [name: string, category: string, price: number, stock: number | null, img: string, description: string, eggless: boolean, tags?: string[]];

const MENU: P[] = [
  ["Fresh Orange Juice", "Juices & Beverages", 70, null, "1600271886742-f049cd451bba", "Freshly squeezed, no added sugar. Served chilled.", true, ["bestseller"]],
  ["Mango Juice", "Juices & Beverages", 80, null, "1546173159-315724a31696", "Thick, sweet mango pulp blended with ice.", true],
  ["Mint Mojito", "Juices & Beverages", 90, null, "1551538827-9c037cb4f32a", "Lime, fresh mint and soda over crushed ice.", true, ["bestseller"]],
  ["Chocolate Milkshake", "Juices & Beverages", 110, null, "1553787499-6f9133860278", "Thick chocolate shake topped with cream.", true],
  ["Oreo Milkshake", "Juices & Beverages", 120, null, "1572490122747-3968b75cc699", "Blended with crushed Oreo and finished with chocolate drizzle.", true],
  ["Berry Smoothie", "Juices & Beverages", 110, null, "1622597467836-f3285f2131b8", "Mixed fruit smoothie, thick and cold.", true, ["new"]],
  ["Iced Coffee", "Juices & Beverages", 100, null, "1461023058943-07fcbe16d735", "Cold coffee over milk and ice.", true],

  ["Grilled Veg Sandwich", "Sandwiches", 70, null, "1528735602780-2552fd46c7af", "Vegetables and cheese, grilled crisp with mint chutney.", true, ["bestseller"]],
  ["Cheese Sandwich", "Sandwiches", 80, null, "1539252554453-80ab65ce3586", "Loaded with melted cheese and fresh veggies.", true],
  ["Club Sandwich", "Sandwiches", 120, null, "1481070414801-51fd732d7184", "Triple-layer club with salad, sauces and cheese.", false],

  ["Ice Cream Cone", "Ice Creams & Desserts", 40, null, "1497034825429-c343d7c6a68f", "Single scoop in a crisp cone. Ask for today's flavours.", true],
  ["Ice Cream Scoops (2)", "Ice Creams & Desserts", 70, null, "1488900128323-21503983a07e", "Two scoops in a cup with your choice of flavour.", true],
  ["Brownie Sundae", "Ice Creams & Desserts", 130, null, "1563805042-7684c019e1cb", "Chocolate sundae with ice cream, cookie crumb and sauce.", true, ["bestseller"]],
  ["Fudge Brownie", "Ice Creams & Desserts", 70, 20, "1606313564200-e75d5e30476c", "Rich, gooey chocolate brownie. Ask us to warm it up.", true],

  ["French Fries", "Fries & Sides", 70, null, "1630384060421-cb20d0e0649d", "Golden, crisp and lightly salted.", true, ["bestseller"]],
  ["Peri-Peri Fries", "Fries & Sides", 90, null, "1576107232684-1279f390859f", "Fries tossed in spicy peri-peri seasoning.", true],
  ["Loaded Fries", "Fries & Sides", 120, null, "1573080496219-bb080dd4f877", "Topped with cheese sauce, herbs and spice mix.", true, ["new"]],
  ["Chicken Nuggets (6)", "Fries & Sides", 110, null, "1626645738196-c2a7c87a8f58", "Crispy fried chicken bites with a dip.", false],
  ["Crispy Chicken Strips", "Fries & Sides", 130, null, "1562967914-608f82629710", "Golden fried strips served with creamy dip.", false],

  ["Steamed Veg Momos (6)", "Momos", 70, null, "1626776876729-bab4369a5a5a", "Soft steamed dumplings with a vegetable filling, served with spicy chutney.", true, ["bestseller"]],
  ["Steamed Chicken Momos (6)", "Momos", 90, null, "1534422298391-e4f8c172dddb", "Juicy chicken filling in thin steamed wrappers.", false],
  ["Fried Momos (6)", "Momos", 90, null, "1563245372-f21724e3856d", "Golden fried momos with a crisp edge.", false],
  ["Spicy Crispy Momos (6)", "Momos", 100, null, "1563245372-f21724e3856d", "Crunchy momos tossed in a hot, tangy sauce.", false, ["new"]],

  ["Veg Burger", "Burgers", 80, null, "1568901346375-23c9450c58cd", "Crisp veg patty, fresh salad and house sauce.", true],
  ["Crispy Chicken Burger", "Burgers", 120, null, "1571091718767-18b5b1457add", "Crunchy fried chicken fillet, lettuce and mayo.", false, ["bestseller"]],
  ["Cheese Burger", "Burgers", 110, null, "1550547660-d9450f859349", "Melted cheese slice over a juicy patty.", false],
  ["Loaded Burger", "Burgers", 150, null, "1568901346375-23c9450c58cd", "Double patty, cheese, salad and our signature sauce.", false, ["new"]],

  ["Chicken Shawarma", "Shawarma & Wraps", 100, null, "1561651823-34feb02250e4", "Grilled chicken with garlic sauce and salad.", false, ["bestseller"]],
  ["Paneer Wrap", "Shawarma & Wraps", 90, null, "1626700051175-6818013e1d4f", "Spiced paneer, onions and mint mayo in a soft wrap.", true],
  ["Chicken Roll", "Shawarma & Wraps", 90, null, "1626700051175-6818013e1d4f", "Rolled flatbread with spiced chicken and sauce.", false],

  ["Cheese Pizza Slice", "Pizza & Snacks", 60, null, "1513104890138-7c749659a591", "Cheesy slice, fresh from the oven.", true],
  ["Veg Loaded Pizza Slice", "Pizza & Snacks", 80, null, "1565299624946-b28f40a0ae38", "Topped with onions, capsicum, corn and olives.", true],
  ["Garlic Bread", "Pizza & Snacks", 70, null, "1573140401552-3fab0b24306f", "Toasted with garlic butter and herbs.", true],
  ["Samosa (2)", "Pizza & Snacks", 30, null, "1601050690597-df0568f70950", "Crisp pastry with spiced potato filling.", true],
  ["Chips", "Pizza & Snacks", 20, 40, "1566478989037-eec170784d0b", "Packet chips, assorted flavours.", true],
];

export const uid = (n = 10) => randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n) || randomBytes(4).toString("hex");

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const code = (n: number) => Array.from(randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join("");

export function seedData(): { products: Product[]; coupons: Coupon[]; shopName: string } {
  const now = Date.now();

  /* Fixed ids keep the menu stable if the database is ever re-seeded. Records
     created at runtime use the random uid()/code() above. */
  const products: Product[] = MENU.map(([name, category, price, stock, img, description, eggless, tags = []], i) => ({
    id: `sp${i + 1}`,
    name,
    category,
    price,
    stock,
    lowAt: 4,
    loyaltyPoints: null,
    description,
    image: U(img),
    eggless,
    tags,
    active: true,
    createdAt: now + i,
    updatedAt: now + i,
  }));

  return {
    shopName: "Grace cafe",
    products,
    coupons: [
      { id: "scoupon1", code: "WELCOME10", percent: 10, minOrder: 500, expiresAt: null, limit: 100, used: 0, active: true, restricted: false, audience: "all", phones: [], sent: 0, createdAt: now },
    ],
  };
}
