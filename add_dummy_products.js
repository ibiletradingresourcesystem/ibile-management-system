const fetch = require('node-fetch');

const dummyProducts = [
  {
    name: "Yogurt Plain",
    sku: "YOG001",
    barcode: "1234567890001",
    description: "Plain yogurt 500ml",
    category: "Dairy",
    quantity: 45,
    minStock: 10,
    unitPrice: 2.50,
    expiryDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days (CRITICAL)
  },
  {
    name: "Milk Fresh",
    sku: "MLK001",
    barcode: "1234567890002",
    description: "Fresh whole milk 1L",
    category: "Dairy",
    quantity: 120,
    minStock: 20,
    unitPrice: 3.00,
    expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days (CRITICAL)
  },
  {
    name: "Cheese Cheddar",
    sku: "CHE001",
    barcode: "1234567890003",
    description: "Aged cheddar cheese 250g",
    category: "Dairy",
    quantity: 30,
    minStock: 5,
    unitPrice: 5.50,
    expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days (WARNING)
  },
  {
    name: "Bread Wheat",
    sku: "BRD001",
    barcode: "1234567890004",
    description: "Whole wheat bread 500g",
    category: "Bakery",
    quantity: 25,
    minStock: 5,
    unitPrice: 2.00,
    expiryDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days (OK)
  },
  {
    name: "Butter Salted",
    sku: "BUT001",
    barcode: "1234567890005",
    description: "Salted butter 200g",
    category: "Dairy",
    quantity: 60,
    minStock: 10,
    unitPrice: 4.00,
    expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days (OK)
  },
  {
    name: "Orange Juice",
    sku: "OJ001",
    barcode: "1234567890006",
    description: "Fresh orange juice 1L",
    category: "Beverages",
    quantity: 80,
    minStock: 15,
    unitPrice: 2.75,
    expiryDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // -1 days (EXPIRED)
  },
  {
    name: "Apple Red",
    sku: "APP001",
    barcode: "1234567890007",
    description: "Fresh red apples per lb",
    category: "Produce",
    quantity: 200,
    minStock: 30,
    unitPrice: 1.50,
    expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days (CRITICAL)
  },
  {
    name: "Yogurt Greek",
    sku: "YOG002",
    barcode: "1234567890008",
    description: "Greek yogurt 400ml",
    category: "Dairy",
    quantity: 35,
    minStock: 8,
    unitPrice: 3.50,
    expiryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days (CRITICAL)
  },
  {
    name: "Tomato Fresh",
    sku: "TOM001",
    barcode: "1234567890009",
    description: "Fresh tomatoes per lb",
    category: "Produce",
    quantity: 150,
    minStock: 25,
    unitPrice: 1.25,
    expiryDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4 days (CRITICAL)
  },
  {
    name: "Banana Yellow",
    sku: "BAN001",
    barcode: "1234567890010",
    description: "Fresh yellow bananas per lb",
    category: "Produce",
    quantity: 250,
    minStock: 40,
    unitPrice: 0.60,
    expiryDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // 25 days (WARNING)
  }
];

async function addProducts() {
  try {
    console.log("Adding dummy products...\n");
    
    for (const product of dummyProducts) {
      const response = await fetch("http://localhost:3002/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product),
      });

      const result = await response.json();
      
      if (result.success) {
        console.log(`✅ Added: ${product.name} (Expires: ${product.expiryDate.toISOString().split('T')[0]})`);
      } else {
        console.log(`❌ Failed: ${product.name} - ${result.message}`);
      }
    }
    
    console.log("\n✅ All products added!");
  } catch (error) {
    console.error("Error adding products:", error.message);
  }
}

addProducts();
