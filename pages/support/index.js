import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { apiClient } from "@/lib/api-client";
import BizFaceLogo from "@/components/BizFaceLogo";
import { showToastMessage } from "@/lib/toast-state";
import { MessageCircle, Send, TicketIcon, ArrowLeft, ChevronDown, ChevronUp, HelpCircle, X, Check, CheckCheck } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "pending_customer", label: "Pending Customer" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS = [
  { value: "all", label: "All Priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "technical", label: "Technical" },
  { value: "tax", label: "Tax" },
  { value: "inventory", label: "Inventory" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];

// Knowledge base for instant Q&A answers
const KNOWLEDGE_BASE = [
  {
    keywords: ["add product", "new product", "create product", "product list"],
    question: "How do I add a new product?",
    answer: "Go to **Manage** → **Product List**.\n1. Click **Add Product**.\n2. Enter the product name, category, cost price, and sale price (inc. tax).\n3. Add barcode, stock controls, expiry date, images, or vendor details if needed.\n4. Turn on **stock managed** if the system should track inventory.\n5. Click **Save**.\n\nUse pack or child-product setup when you want to sell both units and bundles.",
  },
  {
    keywords: ["stock", "inventory level", "low stock", "out of stock", "stock management", "restock"],
    question: "How do I manage stock levels?",
    answer: "Go to **Stock** → **Stock Management** to review on-hand stock by product and location.\n1. Use **Stock Movement** for **Restock**, **Transfer**, or **Return** actions.\n2. Set **min/max stock** on products so low levels are easier to spot.\n3. Review **Expiration Report** for stock nearing expiry.\n4. Use **Stock Take** when physical counts do not match expected quantities.\n\nIf numbers look wrong, check recent stock movements and stock takes before editing product records directly.",
  },
  {
    keywords: ["stock movement", "transfer", "restock", "return", "move stock"],
    question: "How do stock movements work?",
    answer: "Stock movements track all inventory changes. Go to **Stock** → **Stock Movement** to create one. There are three types: **Restock** (brings stock in from a vendor to a location), **Transfer** (moves stock between your locations), and **Return** (sends stock back to a vendor). Each movement requires a source, destination, products, and quantities. Movements automatically update stock levels at the relevant locations.",
  },
  {
    keywords: ["stock take", "count", "physical count", "inventory count", "cycle count"],
    question: "How do I perform a stock take?",
    answer: "Go to **Stock** → **Stock Take** to start a count.\n1. Choose **Full Count**, **Partial Count**, or **Cycle Count**.\n2. Select the location you are counting.\n3. Enter the actual counted quantity for each product.\n4. Submit the count so the system calculates variance against expected stock.\n5. Review the outcome in **Stock Take Report** for discrepancies and trends.\n\nUse stock takes when stock looks inaccurate after transfers, receipts, waste, or fast-moving sales periods.",
  },
  {
    keywords: ["expense", "add expense", "record expense", "expense entry", "track expenses"],
    question: "How do I record an expense?",
    answer: "Go to **Expenses** → **Expenses Entry**. Fill in the expense title, amount, select a category (or create new ones), choose the location, and optionally assign a staff member. You can add notes for reference. Click **Add Expense** to save. View all expense summaries in **Expenses Analysis** which shows breakdowns by category, location, and time period with charts.",
  },
  {
    keywords: ["vendor", "supplier", "add vendor", "manage vendor", "vendor management"],
    question: "How do I manage vendors?",
    answer: "Go to **Manage** → **Procurement** → **Vendors**.\n1. Click **Add Vendor** to save supplier details such as company name, contact, phone, email, address, and bank information.\n2. Link the products the vendor supplies, including cost and pack details where relevant.\n3. Use **Place Order** from the vendor card to create a purchase order.\n4. Track payment and receiving status later in **Payment Tracker**.\n\nKeeping vendor-product links accurate improves procurement speed and receiving accuracy.",
  },
  {
    keywords: ["purchase order", "payment tracker", "vendor payment", "pay vendor"],
    question: "How does the Vendor Payment Tracker work?",
    answer: "Go to **Manage** → **Procurement** → **Payment Tracker**. This page tracks all vendor purchase orders and their payment status (**Not Paid**, **Partly Paid**, **Paid**, **Credit**). Use the **Quick Entry** button for fast payment recording. The dashboard shows overdue orders, outstanding balances, credit orders, and total paid amounts. You can filter by vendor, time period, and status. Click **Edit** on any row to update payment amounts directly.",
  },
  {
    keywords: ["report", "sales report", "analytics", "reporting", "sales data"],
    question: "How do I view sales reports?",
    answer: "Go to **Reporting** in the sidebar.\n1. Open **Sales Report** for the main overview.\n2. Use **Time Intervals** and **Time Comparisons** for trend analysis.\n3. Use **Sales by Product**, **Employees**, **Locations**, and **Categories** for focused breakdowns.\n4. Open **Completed Transactions** when you need transaction-level review, edits, voids, or refunds.\n\nApply the same date range and location filters before comparing pages so the numbers line up.",
  },
  {
    keywords: ["sales report calculation", "net sales", "discount", "refund", "sales total", "report totals", "sales mismatch"],
    question: "Why do sales report totals differ from discounts or refunds?",
    answer: "Sales reports use the transaction's final paid total for completed sales. Discounts are shown separately for visibility and are not subtracted again from the paid total. Refunded transactions are counted in refund metrics instead of normal completed-sale totals.\n\nWhen comparing reports:\n1. Use the same date range, location, device, and staff filters.\n2. Check **Completed Transactions** if a single sale looks unusual.\n3. Remember that product and category reports allocate the final transaction total across sold items, so discounts are shared across the items in that sale.\n4. Voided or held transactions should not increase completed-sales totals.",
  },
  {
    keywords: ["staff", "employee", "add staff", "onboarding", "staff management"],
    question: "How do I add and manage staff?",
    answer: "Go to **Manage** → **Staff** → **Staff Page**. Click **Add New Staff** to create a member with their name, 4-digit PIN, role, location, salary, and bank details. After creation, you'll see options to **Copy Onboarding Link** or **Send Onboarding Link** via email. The onboarding form collects personal details (DOB, address, state of origin, next of kin) and guarantor information. View completed profiles by clicking **View Profile** on any staff card.",
  },
  {
    keywords: ["staff role", "role", "permissions", "staff roles"],
    question: "How do staff roles work?",
    answer: "Go to **Manage** → **Staff** → **Staff Roles** to define custom POS roles. For admin system access, go to **Setup** → **Users** to create users with specific roles: **Admin** (full access), **Sub-Admin** (custom permissions), **Inventory** (manage & stock), **Account** (expenses & reporting), **Manager**, **Staff**, or **Viewer**. Each role can have granular submenu-level permissions — you can control exactly which pages each user can see.",
  },
  {
    keywords: ["transaction", "refund", "void", "edit transaction", "completed transaction"],
    question: "How do I edit or refund a transaction?",
    answer: "Go to **Reporting** → **Completed Transactions**. Find the transaction using search or filters. Expand it to see details. Use the action buttons to **Edit** (modify items/prices), **Void** (cancel entirely), or **Refund** (return payment). All actions require a reason and may need manager approval depending on your role. Voided and refunded transactions are tracked separately in reports.",
  },
  {
    keywords: ["find transaction", "transaction search", "receipt lookup", "completed transactions", "customer transaction", "transaction history"],
    question: "How do I find a completed transaction quickly?",
    answer: "Go to **Reporting** → **Completed Transactions** and use the filters before opening rows.\n1. Search by receipt, customer, product, staff, tender, or location when available.\n2. Narrow the date range first if the list is long.\n3. Expand the matching transaction to review items, tenders, totals, staff, and location.\n4. Use edit, void, or refund only when the transaction really needs correction.\n\nFor EOD or sales-report checks, keep the same date and location filters across pages.",
  },
  {
    keywords: ["location", "add location", "store location", "multi-location"],
    question: "How do I manage store locations?",
    answer: "Navigate to **Setup** → **Company Details**. Here you can add, edit, or remove locations for your business. Each location has a name and can be assigned to staff members, tenders, and stock. Locations are used throughout the system for filtering sales, tracking stock levels, and assigning expenses. Go to **Setup** → **Location Tenders** to configure payment methods available at each location.",
  },
  {
    keywords: ["location items", "assign product location", "product not showing", "missing product till", "visible location", "pos product missing"],
    question: "Why is a product missing from a location or Till?",
    answer: "A product can be active in the admin app but still not appear where staff expect it. Check these items first:\n1. Confirm the product is not archived.\n2. Confirm it is assigned to the correct location in **Setup** → **Location Items** or the product's location settings.\n3. Confirm the product category is correct and not a non-sale/room category.\n4. Confirm the barcode or product name is saved correctly.\n5. Refresh the Till after changes.\n\nLocation assignment controls visibility. Physical stock quantity is still controlled by stock movements and sales.",
  },
  {
    keywords: ["assign location items", "setup location items", "product visibility", "location product setup", "location assignment"],
    question: "How do I assign products to a location?",
    answer: "Use **Setup** → **Location Items** when you need to control which products are available at each branch or selling point. Select the location, choose the products that should be visible there, and save.\n\nAfter assigning products, use **Stock** → **Stock Movement** if you also need to move physical stock into that location. Visibility and stock quantity are related, but they are not the same thing.",
  },
  {
    keywords: ["asset", "equipment", "maintenance", "asset management"],
    question: "How do I track assets and maintenance?",
    answer: "Go to **Setup** → **Assets** to add and manage business equipment and assets. Each asset can have custom properties, purchase date, cost, and condition status. You can schedule maintenance tasks and track disposal. Maintenance costs can be linked to specific assets through the **Expenses** page by selecting the asset category when recording an expense.",
  },
  {
    keywords: ["promotion", "discount", "promo", "sale", "deal"],
    question: "How do I set up promotions?",
    answer: "Navigate to **Manage** → **Promotions**. Create promotions with: discount type (**Percentage** or **Fixed** amount), discount direction (**Discount** to reduce price or **Increment** to increase), date ranges (or set as **Indefinite** for ongoing promos), and assign to specific products. The promo price is calculated automatically. Customer-specific promotions can be created in **Manage** → **Customer Promotions** for targeted deals.",
  },
  {
    keywords: ["password", "login", "access", "permission", "user", "pin"],
    question: "How do I manage user access and permissions?",
    answer: "Go to **Setup** → **Users** to manage admin-app access.\n1. Create or edit the user.\n2. Assign a role such as **Admin**, **Sub-Admin**, **Manager**, **Staff**, or **Viewer**.\n3. Adjust page-level permissions for the exact modules the user should access.\n4. Save and have the user refresh or sign in again if the menu does not update immediately.\n\nThis is separate from POS staff access in **Manage** → **Staff**.",
  },
  {
    keywords: ["verify email", "admin email", "email verification", "setup email", "login email", "admin verification"],
    question: "How do I verify or update the admin email?",
    answer: "Go to **Setup** → **Verify Admin Email** when admin email verification is required. Use the active business email address, complete the verification flow, and sign in again if access or menus do not refresh immediately.\n\nIf verification emails do not arrive, check spelling, spam folders, email provider blocking, and whether the app's email settings are configured correctly.",
  },
  {
    keywords: ["till", "pos", "point of sale", "checkout", "register"],
    question: "How do I access the Point of Sale (Till)?",
    answer: "Click **Till** in the sidebar to open the POS application in a new tab. The POS system allows you to: ring up sales, search products by name or barcode, apply discounts, handle split payments across multiple tender types, hold transactions for later, and process customer-specific promotions. POS staff access is managed separately in **Manage** → **Staff** with POS-specific permissions.",
  },
  {
    keywords: ["tax", "tax report", "tax analysis", "vat", "tax calculator"],
    question: "How do I view tax reports?",
    answer: "Go to **Expenses** → **Tax Analysis** for a comprehensive business tax summary showing your sales tax collected, expense deductions, and net tax obligations. Use **Personal Tax Calculator** under Expenses for individual income tax calculations with Nigerian tax brackets. Products can have individual tax rates set during creation, and these are automatically applied during POS sales and reflected in tax reports.",
  },
  {
    keywords: ["expense analysis", "expense report", "spending", "expense category", "expense location", "cost analysis"],
    question: "How do I review expense analysis?",
    answer: "Go to **Expenses** → **Expenses Analysis** to review spending by category, location, staff, and time period. Use filters before comparing totals. If a cost appears in the wrong place, open **Expenses** → **Expenses Entry** and check the expense date, category, amount, location, staff, and notes.\n\nConsistent categories make tax and accounting reports easier to verify later.",
  },
  {
    keywords: ["eod", "end of day", "close day", "daily report", "reconciliation"],
    question: "How does End of Day (EOD) work?",
    answer: "Navigate to **Reporting** → **End of Day Reports**.\n1. Open the location and day you want to review.\n2. Check tender totals, transaction count, and expected closing balance.\n3. Compare the expected amount against the actual cash or till figure.\n4. Review variance and notes before escalating discrepancies.\n\nThe admin app is strongest for reviewing and analysing EOD data. If your team needs a full guided cashier close-out flow, raise it with support or your system administrator.",
  },
  {
    keywords: ["eod variance", "till variance", "balanced till", "reconciled till", "expected balance", "physical count", "tender mismatch"],
    question: "How do I investigate an End of Day variance?",
    answer: "Open **Reporting** → **End of Day Reports**, expand the report row, and compare the key figures.\n1. **Expected Balance** should be opening balance plus completed sales for the till period.\n2. **Physical Count** should be what was actually counted at close.\n3. **Variance** is physical count minus expected balance.\n4. Tender breakdown helps identify whether cash, card, transfer, or POS entries caused the mismatch.\n\nIf physical count and expected balance are equal, the report should be reconciled. If they differ, check completed, voided, refunded, held, and offline-synced transactions for that location and time window.",
  },
  {
    keywords: ["held", "hold transaction", "pending", "saved transaction"],
    question: "What are held transactions?",
    answer: "Held transactions are sales started on the POS/Till that haven't been completed yet — for example, when a customer is still shopping or needs to come back later. They are **NOT** counted in your sales totals or reports. You can find and resume them from the Till system. Multiple transactions can be held simultaneously, and each is tagged with the staff member who created it.",
  },
  {
    keywords: ["category", "product category", "categories", "organize"],
    question: "How do I manage product categories?",
    answer: "Go to **Manage** → **Categories** to create and edit product categories. Categories help organize your products for easier browsing in the POS and better reporting. You can create hierarchical categories (parent/child). Special categories like **Room** automatically set products as non-stock-managed. Categories are used in reporting for sales-by-category analysis.",
  },
  {
    keywords: ["customer", "customer management", "loyalty", "customer promotions"],
    question: "How do I manage customers?",
    answer: "Navigate to **Manage** → **Customers** to add and manage your customer database. Store customer details like name, phone, email, and address. Customers can be linked to transactions for purchase history tracking. Use **Manage** → **Customer Promotions** to create personalized promotions targeted at specific customers or customer groups.",
  },
  {
    keywords: ["campaign", "marketing", "email campaign"],
    question: "How do campaigns work?",
    answer: "Go to **Manage** → **Campaigns** to create marketing campaigns. Campaigns let you send promotional messages to your customer base. You can target specific customer segments, set campaign dates, and track engagement. Campaigns integrate with your customer database and promotion system for targeted marketing.",
  },
  {
    keywords: ["receipt", "print receipt", "receipt setup"],
    question: "How do I customize receipts?",
    answer: "Go to **Setup** → **Receipts** to configure your receipt template. You can customize the header (business name, address, phone), footer message, and choose what information to display (tax breakdown, staff name, location, etc.). Receipt settings apply to all POS transactions. Receipts can be printed or shared digitally from the Till system.",
  },
  {
    keywords: ["theme", "color theme", "branding", "app color", "setup theme", "appearance"],
    question: "How do I update the app theme or colors?",
    answer: "Go to **Setup** → **Color Theme** to manage the admin app's appearance. Choose colors that keep buttons, text, and status labels readable. After saving, refresh the page if a screen still shows the previous colors.\n\nUse theme changes carefully during working hours so staff do not confuse old and new status colors.",
  },
  {
    keywords: ["tender", "payment method", "pos tender", "cash", "card", "mobile money"],
    question: "How do I set up payment methods (tenders)?",
    answer: "Go to **Setup** → **POS Tenders** to create payment methods like Cash, Card, Mobile Money, Transfer, etc. Each tender can be toggled active/inactive. Use **Setup** → **Location Tenders** to configure which tenders are available at specific locations. Customers can split payments across multiple tender types during checkout at the POS.",
  },
  {
    keywords: ["order", "online order", "manage order", "order status"],
    question: "How do I manage orders?",
    answer: "Go to **Manage** → **Orders** to view and manage all orders. Orders can be filtered by status (Pending, Processing, Completed, Cancelled). Each order shows customer details, products, quantities, and total amount. You can update order status, add notes, and track fulfillment. Orders from the POS Till and online channels appear here.",
  },
  {
    keywords: ["archive", "archived product", "delete product", "remove product"],
    question: "How do I archive or restore products?",
    answer: "Instead of deleting products (which would destroy sales history), you can archive them. Go to **Manage** → **Product List**, find the product, and click **Archive**. Provide a reason for archiving. Archived products are moved to **Manage** → **Archived Products** where they can be viewed, restored, or permanently managed. Archived products don't appear in POS searches.",
  },
  {
    keywords: ["product pagination", "product page", "advanced edit", "cancel product edit", "highlight product", "return to product list"],
    question: "Why does a product stay highlighted after I cancel Advanced edit?",
    answer: "When you open **Advanced** from **Manage** → **Product List** and cancel, the product list returns to the page you were working on and highlights the last product you acted on. This makes it easier to continue editing or reviewing products without losing your place.\n\nUse the page controls and rows-per-page selector at the bottom of the product list when working through a long catalogue.",
  },
  {
    keywords: ["hero", "promo setup", "hero promo", "banner"],
    question: "What is Hero-Promo Setup?",
    answer: "Go to **Setup** → **Hero-Promo Setup** to configure promotional banners and featured content that displays on your customer-facing pages. You can upload hero images, set promotional text, link to specific products or categories, and control display timing. This is useful for highlighting seasonal sales, new arrivals, or special offers.",
  },
  {
    keywords: ["support", "ticket", "help", "issue", "support ticket"],
    question: "How do I create a support ticket?",
    answer: "Open the **Tickets** tab at the top of this page.\n1. Click **New Ticket**.\n2. Add a clear subject and full description.\n3. Choose the right category, priority, and location if the issue is branch-specific.\n4. Submit the ticket and monitor status from the same page.\n\nThe fastest tickets include the page you were on, what you expected, what actually happened, and the exact error or screenshot.",
  },
  {
    keywords: ["pack", "bundle", "pack product", "child product", "unit"],
    question: "How do pack/bundle products work?",
    answer: "When adding products to a vendor in **Manage** → **Vendors**, you can set a product as type **Pack** and specify the quantity per pack. When saved, the system automatically creates a **child product** with the name appended (e.g., 'Rice (Pack of 12)'). The child product's cost price is calculated as the unit cost × quantity per pack. You can then set the sale price manually in the **Product List**. This allows you to sell both individual units and packs.",
  },
  {
    keywords: ["stock location", "physical stock", "location stock", "moved to", "visible location", "stock by location"],
    question: "Why does Stock Management show stock by moved-to location?",
    answer: "**Stock Management** shows where stock physically sits, based on stock movements and sales history. Product visibility locations only decide where a product can appear or be assigned; they are not the same as physical on-hand stock.\n\nUse **Stock Movement** to restock into a location, transfer between locations, return to vendor, or record operational loss. The Stock Management location filter should then reflect the movement destination and any sales from that location.",
  },
  {
    keywords: ["stock take pack", "stock take child", "count pack and each", "loose units", "parent child stock take", "partial pack count"],
    question: "How do I count pack and each products during stock take?",
    answer: "During **Stock Take**, pack products and their each/loose child can be counted together from one product row. Enter the available pack count, loose-unit count, or both depending on what is physically present.\n\nExamples:\n1. If only sealed packs are present, enter the pack count and leave loose units as zero.\n2. If only loose units are present, enter the each count and leave packs as zero.\n3. If both are present, enter both values.\n\nThe system combines the values using the product's quantity-per-pack when calculating variance and adjustment.",
  },
  {
    keywords: ["expiry", "expired", "expiration", "shelf life"],
    question: "How does expiry tracking work?",
    answer: "When adding or editing a product, you can set an **Expiry Date**. The system automatically marks products as expired when the date passes. View all products approaching or past expiry in **Stock** → **Expiration Report**. This report helps you identify products that need to be sold quickly, discounted, or removed from shelves. Expired flags update automatically on each page load.",
  },
  {
    keywords: ["fifo", "batch sold out", "sold out batch", "batch quantity", "expiration adjustment", "remaining batch quantity"],
    question: "Why is an expiring batch marked sold out?",
    answer: "The **Batch Expiration Report** tracks remaining batch quantity using FIFO logic. As sales and stock-out movements consume a product at a location, the oldest matching batch is depleted first. When a batch reaches zero remaining quantity, it is marked **Sold out** and the adjustment action is disabled because there is no remaining stock in that batch to adjust.\n\nIf the sold-out status looks wrong, review recent sales, transfers, returns, adjustments, and operational-loss movements for that product and location.",
  },
  {
    keywords: ["accounting", "profit and loss", "p&l", "balance sheet", "trial balance", "general ledger", "journal entry", "chart of accounts"],
    question: "How do accounting reports and journals work?",
    answer: "Use the **Accounting** section for formal financial records.\n1. Open **Reports** for **Profit & Loss**, **Balance Sheet**, and **Trial Balance**.\n2. Use **Journal Entries** to create manual entries, drafts, postings, and voids.\n3. Use **General Ledger** to inspect one account's running balance and history.\n4. Use **Chart of Accounts** to manage the account list.\n\nSales, expenses, refunds, and purchase-order payments feed accounting automatically. Owner capital, loans, depreciation, and corrections should still be entered manually.",
  },
  {
    keywords: ["sync accounting", "accounting sync", "stale report", "refresh accounting", "journal not updated"],
    question: "How does accounting sync work?",
    answer: "Accounting pages use a throttled background sync so they stay responsive.\n1. Open the accounting page you want to review.\n2. Check the last-sync time at the top.\n3. Click **Sync Accounting** if the data looks behind current sales, expenses, refunds, or purchase orders.\n4. Wait for the refresh message and then review the updated figures.\n\nUse manual sync before month-end checks, after bulk changes, or while investigating mismatches.",
  },
  {
    keywords: ["receive purchase order", "confirm received", "po receipt", "goods received", "restock from po"],
    question: "How do I receive a purchase order into stock?",
    answer: "Open **Manage** → **Procurement** → **Payment Tracker**.\n1. Locate the purchase order.\n2. Update payment details if needed.\n3. Use the receive or confirm-received action to mark the order as received.\n4. Verify the receiving status and stock update.\n\nThe receive step is what creates the stock movement and adds inventory. Recording payment alone does not increase stock.",
  },
  {
    keywords: ["stock movement type", "stock adjustment", "adjustment", "operational loss", "return to vendor", "transfer stock", "restock type"],
    question: "Which stock movement type should I use?",
    answer: "Choose the stock movement based on what physically happened.\n1. **Restock**: stock came into a location from a vendor or receiving process.\n2. **Transfer**: stock moved from one internal location to another.\n3. **Return**: stock left your business and went back to a vendor.\n4. **Adjustment**: stock needs a correction after review or approval.\n5. **Operational Loss**: stock was damaged, expired, wasted, stolen, or missing.\n\nUse clear notes so future stock and accounting reviews can understand the reason.",
  },
  {
    keywords: ["apply stock take", "stock take adjustment", "approve stock take", "zero uncounted", "remove uncounted", "stock take variance reason"],
    question: "What happens when I apply stock-take adjustments?",
    answer: "After counting, review the stock-take variances before applying adjustments. Add a reason for important differences, then apply adjustments only when the count is approved.\n\nUse **Zero Uncounted** when uncounted items should be treated as zero. Use **Remove Uncounted** when those items should be left out of the stock take instead. Once adjustments are applied, inventory is updated to match the approved count.",
  },
  {
    keywords: ["operational loss", "damaged stock", "waste", "expired stock", "missing stock", "write off"],
    question: "How do I record operational loss or damaged stock?",
    answer: "Use **Stock** → **Stock Movement** when stock leaves the business because of damage, waste, expiry, or unexplained loss.\n1. Choose the operational-loss style movement.\n2. Select the location.\n3. Add the affected products and quantities.\n4. Save with a clear reason or note.\n\nThis keeps stock realistic and helps reporting separate shrinkage or wastage from normal sales.",
  },
  {
    keywords: ["split payment", "split tender", "multiple payment methods", "cash and card", "pay partly cash partly transfer"],
    question: "How do split payments work at the Till?",
    answer: "At the **Till**, one sale can be completed with more than one tender type.\n1. Confirm the needed tenders are active in **Setup** → **POS Tenders**.\n2. Confirm the location has those tenders assigned in **Setup** → **Location Tenders**.\n3. During checkout, enter amounts against each tender until the full balance is covered.\n4. Complete the sale and review the tender breakdown in reporting if needed.\n\nThis is useful for cash-plus-transfer, card-plus-cash, or other split-payment scenarios.",
  },
  {
    keywords: ["order location", "fulfilment location", "fulfillment location", "assign order location", "online order location"],
    question: "How do order fulfilment locations work?",
    answer: "Go to **Manage** → **Orders** and open the order details to assign or clear a fulfilment location. This is useful for routing online or central orders to the branch that should handle them. The chosen location improves management visibility and reporting context, especially after delivery. If a delivered order's location changes later, the system keeps the transaction location in sync for reporting purposes.",
  },
  {
    keywords: ["offline", "internet down", "queued transaction", "offline pos", "sync later"],
    question: "What happens if the Till goes offline?",
    answer: "The system supports offline POS queueing, so temporary internet loss should not mean lost sales. Transactions created while offline can be held locally and synced when the connection returns. If staff believe a sale may have been queued, avoid ringing it twice immediately. First confirm whether the transaction appears as held, completed, or synced after connectivity is restored, then escalate to support if the count still looks wrong.",
  },
  {
    keywords: ["hotel", "reservation", "room booking", "guest", "hotel reservations"],
    question: "How do hotel reservations work?",
    answer: "Use **Manage** → **Hotel Reservations** to work with guest bookings.\n1. Open the reservation list and select the booking.\n2. Review guest details, booking dates, room details, and status.\n3. Update the booking or send guest communication from the reservation workflow when needed.\n4. Raise a support ticket with the guest name, room, dates, and status if the reservation behaves unexpectedly.\n\nThis gives support enough context to trace room or reservation issues quickly.",
  },
];

const SECTION_DEFINITIONS = [
  { key: "pos", label: "POS & Till", keywords: ["pos", "till", "checkout", "split payment", "held transaction", "tender", "receipt", "missing product"] },
  { key: "stock", label: "Stock & Inventory", keywords: ["stock", "inventory", "product", "restock", "stock take", "expiry", "fifo", "batch", "adjustment", "operational loss", "category", "pack", "location stock", "location items"] },
  { key: "procurement", label: "Procurement", keywords: ["vendor", "supplier", "purchase order", "payment tracker", "receive"] },
  { key: "reporting", label: "Reporting & EOD", keywords: ["report", "sales report", "sales total", "discount", "refund", "completed transactions", "transaction search", "end of day", "eod", "till variance", "employees", "locations", "categories"] },
  { key: "accounting", label: "Accounting", keywords: ["accounting", "profit and loss", "balance sheet", "trial balance", "general ledger", "journal", "chart of accounts", "sync accounting"] },
  { key: "users", label: "Users & Setup", keywords: ["user", "permission", "role", "location", "receipt", "hero promo", "setup", "access", "admin email", "theme", "color"] },
  { key: "orders", label: "Orders & Customers", keywords: ["order", "customer", "promotion", "campaign", "fulfilment"] },
  { key: "hotel", label: "Hotel", keywords: ["hotel", "reservation", "room", "guest"] },
  { key: "support", label: "Support", keywords: ["support", "ticket", "help"] },
];

const QUESTION_SECTION_MAP = {
  "How do I add a new product?": "stock",
  "How do I manage stock levels?": "stock",
  "How do stock movements work?": "stock",
  "How do I perform a stock take?": "stock",
  "How do I record an expense?": "accounting",
  "How do I manage vendors?": "procurement",
  "How does the Vendor Payment Tracker work?": "procurement",
  "How do I view sales reports?": "reporting",
  "Why do sales report totals differ from discounts or refunds?": "reporting",
  "How do I add and manage staff?": "users",
  "How do staff roles work?": "users",
  "How do I edit or refund a transaction?": "reporting",
  "How do I find a completed transaction quickly?": "reporting",
  "How do I manage store locations?": "users",
  "Why is a product missing from a location or Till?": "stock",
  "How do I assign products to a location?": "users",
  "How do I track assets and maintenance?": "accounting",
  "How do I set up promotions?": "orders",
  "How do I manage user access and permissions?": "users",
  "How do I verify or update the admin email?": "users",
  "How do I access the Point of Sale (Till)?": "pos",
  "How do I view tax reports?": "accounting",
  "How do I review expense analysis?": "accounting",
  "How does End of Day (EOD) work?": "reporting",
  "How do I investigate an End of Day variance?": "reporting",
  "What are held transactions?": "pos",
  "How do I manage product categories?": "stock",
  "How do I manage customers?": "orders",
  "How do campaigns work?": "orders",
  "How do I customize receipts?": "users",
  "How do I update the app theme or colors?": "users",
  "How do I set up payment methods (tenders)?": "pos",
  "How do I manage orders?": "orders",
  "How do I archive or restore products?": "stock",
  "Why does a product stay highlighted after I cancel Advanced edit?": "stock",
  "What is Hero-Promo Setup?": "users",
  "How do I create a support ticket?": "support",
  "How do pack/bundle products work?": "stock",
  "Why does Stock Management show stock by moved-to location?": "stock",
  "How do I count pack and each products during stock take?": "stock",
  "How does expiry tracking work?": "stock",
  "Why is an expiring batch marked sold out?": "stock",
  "How do accounting reports and journals work?": "accounting",
  "How does accounting sync work?": "accounting",
  "How do I receive a purchase order into stock?": "procurement",
  "Which stock movement type should I use?": "stock",
  "What happens when I apply stock-take adjustments?": "stock",
  "How do I record operational loss or damaged stock?": "stock",
  "How do split payments work at the Till?": "pos",
  "How do order fulfilment locations work?": "orders",
  "What happens if the Till goes offline?": "pos",
  "How do hotel reservations work?": "hotel",
};

const FEATURED_TOPIC_QUESTIONS = [
  "How do I add a new product?",
  "How do I manage stock levels?",
  "How do I perform a stock take?",
  "What happens when I apply stock-take adjustments?",
  "Why does Stock Management show stock by moved-to location?",
  "How do I count pack and each products during stock take?",
  "Why is an expiring batch marked sold out?",
  "Which stock movement type should I use?",
  "How do I manage vendors?",
  "How do I receive a purchase order into stock?",
  "How do split payments work at the Till?",
  "How do I view sales reports?",
  "Why do sales report totals differ from discounts or refunds?",
  "How do I find a completed transaction quickly?",
  "How do accounting reports and journals work?",
  "How do I review expense analysis?",
  "How does accounting sync work?",
  "How does End of Day (EOD) work?",
  "How do I investigate an End of Day variance?",
  "How do I manage user access and permissions?",
  "How do I verify or update the admin email?",
  "Why is a product missing from a location or Till?",
  "How do I assign products to a location?",
  "How do I create a support ticket?",
  "How do hotel reservations work?",
  "How do I record operational loss or damaged stock?",
];

const FEATURED_TOPICS = FEATURED_TOPIC_QUESTIONS
  .map((question) => KNOWLEDGE_BASE.find((entry) => entry.question === question))
  .filter(Boolean);

const FEATURED_TOPIC_GROUPS = SECTION_DEFINITIONS.map((section) => ({
  ...section,
  entries: FEATURED_TOPICS.filter((entry) => QUESTION_SECTION_MAP[entry.question] === section.key),
})).filter((section) => section.entries.length > 0);

function formatStatusLabel(value) {
  return String(value || "open").replace(/_/g, " ");
}

function normalizeSupportText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSupportText(value) {
  return normalizeSupportText(value).split(" ").filter((token) => token.length > 1);
}

function getKnowledgeSection(entry) {
  return QUESTION_SECTION_MAP[entry.question] || "support";
}

function getSectionDefinition(sectionKey) {
  return SECTION_DEFINITIONS.find((section) => section.key === sectionKey) || SECTION_DEFINITIONS[SECTION_DEFINITIONS.length - 1];
}

function searchKnowledgeBase(query) {
  if (!query || query.trim().length < 2) return [];
  const normalizedQuery = normalizeSupportText(query);
  const words = tokenizeSupportText(query);
  
  return KNOWLEDGE_BASE
    .map((entry) => {
      let score = 0;
      const normalizedQuestion = normalizeSupportText(entry.question);
      const normalizedAnswer = normalizeSupportText(entry.answer);
      const normalizedKeywords = entry.keywords.map((keyword) => normalizeSupportText(keyword));
      const section = getSectionDefinition(getKnowledgeSection(entry));

      if (normalizedQuestion.includes(normalizedQuery)) score += 40;
      if (normalizedAnswer.includes(normalizedQuery)) score += 10;

      normalizedKeywords.forEach((keyword) => {
        if (normalizedQuery.includes(keyword) || keyword.includes(normalizedQuery)) score += 18;
      });

      words.forEach((word) => {
        if (normalizedQuestion.includes(word)) score += 6;
        if (normalizedAnswer.includes(word)) score += 2;
        normalizedKeywords.forEach((keyword) => {
          if (keyword.includes(word)) score += 5;
        });
        if (section.label.toLowerCase().includes(word)) score += 3;
        section.keywords.forEach((keyword) => {
          if (keyword.includes(word) || word.includes(keyword)) score += 3;
        });
      });

      const matchedWords = new Set(
        words.filter((word) =>
          normalizedQuestion.includes(word)
          || normalizedAnswer.includes(word)
          || normalizedKeywords.some((keyword) => keyword.includes(word))
        )
      );
      score += matchedWords.size * 2;

      return { ...entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function buildRelatedQuestions(primaryEntry, searchResults) {
  const related = [];
  const seen = new Set([primaryEntry.question]);
  const primarySection = getKnowledgeSection(primaryEntry);

  const pushQuestion = (question) => {
    if (!question || seen.has(question)) return;
    seen.add(question);
    related.push(question);
  };

  searchResults.forEach((entry) => {
    if (entry.question !== primaryEntry.question && getKnowledgeSection(entry) === primarySection) {
      pushQuestion(entry.question);
    }
  });

  KNOWLEDGE_BASE.forEach((entry) => {
    if (entry.question !== primaryEntry.question && getKnowledgeSection(entry) === primarySection) {
      pushQuestion(entry.question);
    }
  });

  searchResults.forEach((entry) => {
    if (entry.question !== primaryEntry.question) {
      pushQuestion(entry.question);
    }
  });

  return related.slice(0, 3);
}

function renderInlineMarkdown(text) {
  return String(text || "").split("**").map((part, index) => (
    index % 2 === 1 ? <strong key={index}>{part}</strong> : <span key={index}>{part}</span>
  ));
}

function renderMarkdown(text) {
  const lines = String(text || "").split("\n");
  const elements = [];
  let listType = null;
  let listItems = [];

  const flushList = () => {
    if (listItems.length === 0) return;

    if (listType === "ordered") {
      elements.push(
        <ol key={`list-${elements.length}`} className="list-decimal pl-5 space-y-1">
          {listItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
        </ol>
      );
    } else {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc pl-5 space-y-1">
          {listItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
        </ul>
      );
    }

    listType = null;
    listItems = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      if (listType && listType !== "ordered") flushList();
      listType = "ordered";
      listItems.push(orderedMatch[1]);
      return;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (listType && listType !== "unordered") flushList();
      listType = "unordered";
      listItems.push(bulletMatch[1]);
      return;
    }

    flushList();
    elements.push(
      <p key={`paragraph-${index}`}>
        {renderInlineMarkdown(line)}
      </p>
    );
  });

  flushList();
  return elements;
}

export default function SupportPage() {
  const [view, setView] = useState("chat"); // "chat" or "tickets"
  const [chatMessages, setChatMessages] = useState([
    { id: 1, role: "system", text: "Hi! I'm your Support Assistant. Ask me anything about using the system, or browse common topics below. If I can't help, you can create a support ticket." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [showQuickTopics, setShowQuickTopics] = useState(false);
  const [activeQuickTopicSection, setActiveQuickTopicSection] = useState(FEATURED_TOPIC_GROUPS[0]?.key || "");
  const [isTalking, setIsTalking] = useState(false);
  const chatEndRef = useRef(null);

  // Ticket state
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [comment, setComment] = useState("");
  const [filters, setFilters] = useState({
    status: "all",
    priority: "all",
    search: "",
    mine: false,
  });
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [form, setForm] = useState({
    subject: "",
    description: "",
    category: "general",
    priority: "medium",
    location: "",
  });

  const selectedTicket = useMemo(
    () => tickets.find((t) => t._id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );
  const activeQuickTopicGroup = useMemo(
    () => FEATURED_TOPIC_GROUPS.find((section) => section.key === activeQuickTopicSection) || FEATURED_TOPIC_GROUPS[0] || null,
    [activeQuickTopicSection]
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (!message) return;
    showToastMessage({ title: "Support center", text: message });
    setMessage("");
  }, [message]);

  async function fetchTickets() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.priority !== "all") params.set("priority", filters.priority);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.mine) params.set("mine", "true");

      const res = await apiClient.get(`/api/support?${params.toString()}`);
      const list = res.data?.tickets || [];
      setTickets(list);
      if (!selectedTicketId && list.length) setSelectedTicketId(list[0]._id);
      if (selectedTicketId && !list.find((t) => t._id === selectedTicketId)) {
        setSelectedTicketId(list[0]?._id || null);
      }
    } catch (error) {
      setMessage(error?.response?.data?.error || "Failed to fetch support tickets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (view === "tickets") fetchTickets();
  }, [view, filters.status, filters.priority, filters.mine]);

  const handleChatSend = () => {
    const text = chatInput.trim();
    if (!text) return;

    const userMsg = { id: Date.now(), role: "user", text };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsTalking(true);

    // Search knowledge base
    const results = searchKnowledgeBase(text);

    setTimeout(() => {
      if (results.length > 0) {
        const primaryResult = results[0];
        const answer = {
          id: Date.now() + 1,
          role: "system",
          text: primaryResult.answer,
          relatedQuestions: buildRelatedQuestions(primaryResult, results),
        };
        setChatMessages(prev => [...prev, answer]);
      } else {
        const noMatch = {
          id: Date.now() + 1,
          role: "system",
          text: "I don't have a specific answer for that. You can try rephrasing your question, or create a support ticket for personalized help from the team.",
          showTicketPrompt: true,
        };
        setChatMessages(prev => [...prev, noMatch]);
      }
      setIsTalking(false);
    }, 400);
  };

  const handleQuickTopic = (entry) => {
    const userMsg = { id: Date.now(), role: "user", text: entry.question };
    setIsTalking(true);
    setChatMessages(prev => [...prev, userMsg]);
    setTimeout(() => {
      const answer = { id: Date.now() + 1, role: "system", text: entry.answer };
      setChatMessages(prev => [...prev, answer]);
      setIsTalking(false);
    }, 300);
  };

  const handleRelatedQuestion = (question) => {
    const entry = KNOWLEDGE_BASE.find(e => e.question === question);
    if (entry) handleQuickTopic(entry);
  };

  const startTicketFromChat = () => {
    // Pre-fill the ticket with the last user message
    const lastUserMsg = [...chatMessages].reverse().find(m => m.role === "user");
    setForm(prev => ({
      ...prev,
      subject: lastUserMsg?.text?.slice(0, 100) || "",
      description: lastUserMsg?.text || "",
    }));
    setShowNewTicket(true);
    setView("tickets");
  };

  const submitTicket = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.description.trim()) {
      setMessage("Subject and description are required.");
      return;
    }
    try {
      setSaving(true);
      setMessage("");
      await apiClient.post("/api/support", form);
      setForm({ subject: "", description: "", category: "general", priority: "medium", location: "" });
      setShowNewTicket(false);
      setMessage("Support ticket created successfully.");
      await fetchTickets();
    } catch (error) {
      setMessage(error?.response?.data?.error || "Failed to create support ticket");
    } finally {
      setSaving(false);
    }
  };

  const updateTicket = async (payload) => {
    if (!selectedTicket) return;
    try {
      setSaving(true);
      setMessage("");
      await apiClient.put(`/api/support/${selectedTicket._id}`, payload);
      if (payload.comment) setComment("");
      await fetchTickets();
      setMessage("Ticket updated.");
    } catch (error) {
      setMessage(error?.response?.data?.error || "Failed to update ticket");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="page-title">Support Center</h1>
              <p className="page-subtitle">Ask questions or create support tickets</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setView("chat")}
                className={`flex items-center gap-2 border px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  view === "chat" ? "theme-toggle-active" : "theme-toggle-neutral"
                }`}
              >
                <MessageCircle className="w-4 h-4" />
                Q&A
              </button>
              <button
                onClick={() => setView("tickets")}
                className={`flex items-center gap-2 border px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  view === "tickets" ? "theme-toggle-active" : "theme-toggle-neutral"
                }`}
              >
                <TicketIcon className="w-4 h-4" />
                Tickets
              </button>
            </div>
          </div>

          {/* ======== CHAT Q&A VIEW ======== */}
          {view === "chat" && (
            <div className="flex flex-col rounded-xl overflow-hidden shadow-lg border border-gray-200" style={{ height: "calc(100vh - 220px)", minHeight: "500px" }}>
              {/* WhatsApp-style Header */}
              <div className="px-4 py-3 flex items-center gap-3" style={{ backgroundColor: "var(--table-header-bg)", borderBottom: "1px solid var(--table-header-border)" }}>
                <div className="w-10 h-10 rounded-2xl overflow-hidden shadow-md ring-2 ring-white/30 flex items-center justify-center">
                  <BizFaceLogo size={40} isTalking={isTalking} />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold text-sm">BizSuits Support</h3>
                  <p className="text-white/70 text-xs">Online • Always here to help</p>
                </div>
              </div>

              {/* Chat Messages - WhatsApp wallpaper style */}
              <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3" style={{ backgroundColor: "#e5ddd5", backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c8bfb0' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}>
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {msg.role === "system" && (
                      <div className="w-7 h-7 rounded-xl overflow-hidden shadow-sm shrink-0 mr-2 mt-auto mb-1">
                        <BizFaceLogo size={28} isTalking={isTalking && msg.id === chatMessages[chatMessages.length - 1]?.id} />
                      </div>
                    )}
                    <div className="relative max-w-[85%] sm:max-w-[70%]">
                      <div
                        className={`rounded-lg px-3 py-2 text-sm leading-relaxed shadow-sm ${
                          msg.role === "user"
                            ? "bg-[#dcf8c6] text-gray-800 rounded-tr-none"
                            : "bg-white text-gray-800 rounded-tl-none"
                        }`}
                      >
                        <div className="space-y-2">{renderMarkdown(msg.text)}</div>

                        {/* Related questions */}
                        {msg.relatedQuestions?.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-200">
                            <p className="text-[11px] text-gray-500 mb-1">Related:</p>
                            {msg.relatedQuestions.map((q, i) => (
                              <button
                                key={i}
                                onClick={() => handleRelatedQuestion(q)}
                                className="block text-left text-xs text-[#4c63ae] hover:text-[#3a4f8c] hover:underline mt-1"
                              >
                                → {q}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Ticket prompt */}
                        {msg.showTicketPrompt && (
                          <button
                            onClick={startTicketFromChat}
                            className="mt-2 flex items-center gap-2 text-xs bg-[#4c63ae]/10 text-[#4c63ae] px-3 py-1.5 rounded-lg hover:bg-[#4c63ae]/20 transition-colors border border-[#4c63ae]/20"
                          >
                            <TicketIcon className="w-3.5 h-3.5" />
                            Create Support Ticket
                          </button>
                        )}
                      </div>
                      <div className={`flex items-center gap-1 mt-0.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <span className="text-[10px] text-gray-500">{new Date(msg.id).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        {msg.role === "user" && <CheckCheck size={12} className="text-[#53bdeb]" />}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Quick Topics - Always visible */}
              <div className="px-3 py-2.5 bg-white border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowQuickTopics((prev) => !prev)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <span className="text-xs text-gray-500 flex items-center gap-2">
                    <HelpCircle className="w-3.5 h-3.5" />
                    Common topics by area
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 border border-gray-200">
                      {FEATURED_TOPICS.length}
                    </span>
                  </span>
                  {showQuickTopics ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                {showQuickTopics && activeQuickTopicGroup && (
                  <div className="mt-3 rounded-2xl border border-gray-200 bg-[#f8fafc] p-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {FEATURED_TOPIC_GROUPS.map((section) => {
                        const isActive = section.key === activeQuickTopicGroup.key;

                        return (
                          <button
                            key={section.key}
                            type="button"
                            onClick={() => setActiveQuickTopicSection(section.key)}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              isActive
                                ? "border-[#4c63ae]/30 bg-[#4c63ae] text-white shadow-sm"
                                : "border-gray-200 bg-white text-gray-600 hover:border-[#4c63ae]/20 hover:text-[#4c63ae]"
                            }`}
                          >
                            <span>{section.label}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"}`}>
                              {section.entries.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{activeQuickTopicGroup.label}</p>
                          <p className="text-[11px] text-gray-500">Choose a question to send it into the chat instantly.</p>
                        </div>
                        <span className="text-[11px] font-medium text-gray-500">
                          {activeQuickTopicGroup.entries.length} topic{activeQuickTopicGroup.entries.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {activeQuickTopicGroup.entries.map((entry, index) => (
                          <button
                            key={`${activeQuickTopicGroup.key}-${index}`}
                            onClick={() => handleQuickTopic(entry)}
                            className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 hover:bg-[#4c63ae]/10 hover:text-[#4c63ae] transition-colors border border-gray-200"
                          >
                            {entry.question}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input - WhatsApp style */}
              <div className="bg-[#f0f0f0] px-3 py-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleChatSend(); }}
                    placeholder="Type a message..."
                    className="flex-1 rounded-full px-4 py-2 text-sm bg-white border-0 focus:ring-2 focus:ring-[#4c63ae]/30 outline-none shadow-sm"
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={!chatInput.trim()}
                    className="w-10 h-10 rounded-full bg-[#4c63ae] text-white flex items-center justify-center hover:bg-[#3a4f8c] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 text-center">
                  Can't find what you need?{" "}
                  <button onClick={() => { setView("tickets"); setShowNewTicket(true); }} className="text-[#4c63ae] hover:underline">
                    Create a support ticket
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* ======== TICKETS VIEW ======== */}
          {view === "tickets" && (
            <div>
              {/* New Ticket Form (collapsible) */}
              <div className="content-card mb-4">
                <button
                  onClick={() => setShowNewTicket(!showNewTicket)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <h2 className="text-lg font-semibold text-gray-900">New Ticket</h2>
                  {showNewTicket ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
                </button>
                {showNewTicket && (
                  <form onSubmit={submitTicket} className="space-y-3 mt-4">
                    <input
                      className="form-input"
                      placeholder="Subject"
                      value={form.subject}
                      onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                    />
                    <textarea
                      className="form-input min-h-28"
                      placeholder="Describe the issue in detail"
                      value={form.description}
                      onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        className="form-select"
                        value={form.category}
                        onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                      >
                        {CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <select
                        className="form-select"
                        value={form.priority}
                        onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                      >
                        {PRIORITY_OPTIONS.filter((p) => p.value !== "all").map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      className="form-input"
                      placeholder="Location (optional)"
                      value={form.location}
                      onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
                    />
                    <button type="submit" className="btn-action btn-action-primary w-full" disabled={saving}>
                      {saving ? "Submitting..." : "Create Ticket"}
                    </button>
                  </form>
                )}
              </div>

              {/* Ticket Filters */}
              <div className="content-card">
                <div className="flex flex-col md:flex-row gap-3 mb-4">
                  <input
                    className="form-input md:flex-1"
                    placeholder="Search ticket number, subject, description..."
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") fetchTickets(); }}
                  />
                  <select
                    className="form-select md:w-48"
                    value={filters.status}
                    onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <select
                    className="form-select md:w-44"
                    value={filters.priority}
                    onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))}
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button
                    className={`btn-action ${filters.mine ? "btn-action-primary" : "btn-action-secondary"}`}
                    onClick={() => setFilters((prev) => ({ ...prev, mine: !prev.mine }))}
                  >
                    {filters.mine ? "My Tickets" : "All Tickets"}
                  </button>
                  <button className="btn-action btn-action-secondary" onClick={fetchTickets}>
                    Refresh
                  </button>
                </div>

                {loading ? (
                  <div className="text-sm text-gray-500 py-8 text-center">Loading support tickets...</div>
                ) : tickets.length === 0 ? (
                  <div className="text-sm text-gray-500 py-8 text-center">No tickets found for current filters.</div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Ticket List */}
                    <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[620px] overflow-y-auto">
                      {tickets.map((ticket) => (
                        <button
                          key={ticket._id}
                          onClick={() => setSelectedTicketId(ticket._id)}
                          className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                            selectedTicketId === ticket._id ? "bg-sky-50" : "bg-white"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-sm text-gray-900">{ticket.ticketNumber}</span>
                            <span className="text-xs rounded-full px-2 py-0.5 bg-gray-100 text-gray-700">{formatStatusLabel(ticket.status)}</span>
                          </div>
                          <p className="text-sm text-gray-800 mt-1">{ticket.subject}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {ticket.priority} • {ticket.category} • {new Date(ticket.createdAt).toLocaleString()}
                          </p>
                        </button>
                      ))}
                    </div>

                    {/* Ticket Detail */}
                    <div className="border border-gray-200 rounded-lg p-4 bg-white">
                      {!selectedTicket ? (
                        <div className="text-sm text-gray-500">Select a ticket to view details.</div>
                      ) : (
                        <div>
                          <h3 className="font-semibold text-gray-900">{selectedTicket.subject}</h3>
                          <p className="text-xs text-gray-500 mt-1">{selectedTicket.ticketNumber}</p>
                          <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap">{selectedTicket.description}</p>

                          <div className="grid grid-cols-2 gap-3 mt-4">
                            <select
                              className="form-select"
                              value={selectedTicket.status}
                              onChange={(e) => updateTicket({ status: e.target.value })}
                              disabled={saving}
                            >
                              {STATUS_OPTIONS.filter((s) => s.value !== "all").map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <select
                              className="form-select"
                              value={selectedTicket.priority}
                              onChange={(e) => updateTicket({ priority: e.target.value })}
                              disabled={saving}
                            >
                              {PRIORITY_OPTIONS.filter((p) => p.value !== "all").map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </div>

                          <div className="mt-4">
                            <textarea
                              className="form-input min-h-24"
                              placeholder="Add update/comment..."
                              value={comment}
                              onChange={(e) => setComment(e.target.value)}
                            />
                            <button
                              className="btn-action btn-action-primary mt-2"
                              disabled={saving || !comment.trim()}
                              onClick={() => updateTicket({ comment })}
                            >
                              {saving ? "Saving..." : "Add Comment"}
                            </button>
                          </div>

                          <div className="mt-4 border-t border-gray-200 pt-3 max-h-56 overflow-y-auto">
                            <h4 className="text-sm font-semibold text-gray-900 mb-2">Timeline</h4>
                            {(selectedTicket.comments || []).length === 0 ? (
                              <p className="text-xs text-gray-500">No comments yet.</p>
                            ) : (
                              <div className="space-y-2">
                                {selectedTicket.comments.map((c) => (
                                  <div key={c._id} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                    <p className="text-sm text-gray-800">{c.message}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                      {c.byName || c.byEmail || "System"} • {new Date(c.createdAt).toLocaleString()}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
