/**
 * How this business works, for every AI prompt and the figures behind them, so the analyses agree.
 *
 * Petty cash buys fresh stock daily or weekly so it does not go bad: that is stock, reaching profit
 * as cost of goods sold, not a running cost. Dead stock is stock that has not sold a single unit
 * within its window; long-life goods are given longer.
 */

/** Days without one unit sold before a product is dead stock. */
export const DEAD_STOCK_DAYS = 60;
/** The same, for long-life goods such as Home & Kitchen. */
export const LONG_LIFE_DEAD_STOCK_DAYS = 90;

/**
 * Category types (the icon picked on Manage → Categories) whose goods keep and are expected to sit
 * longer. A sub-category takes its parent's type when it has none of its own.
 */
export const LONG_LIFE_CATEGORY_TYPES = new Set([
  "home-kitchen",
  "furniture",
  "bed",
  "lounge",
  "tools",
  "electronic-electrical",
  "clothing",
  "fashion",
  "games-toys",
  "gift",
  "stationeries",
  "seasonal-events",
]);

export const SHOP_RULES_FOR_AI = `SHOP RULES (read every figure by these):
- Petty cash purchases are stock bought daily or weekly in small amounts so fresh goods do not go bad. They are stock, counted in cost of goods sold when they sell, not running costs. Never count them as expenses, call them overspending, or advise buying them in bulk or less often.
- Dead stock is a product with stock on the shelf that has not sold a single unit in ${DEAD_STOCK_DAYS / 30} months, or in ${LONG_LIFE_DEAD_STOCK_DAYS / 30} months for Home & Kitchen and other long-life goods (furniture, bedding, tools, electronics, clothing, toys, gifts, stationery, seasonal). A product that sold even one unit in that time is slow, not dead.`;
