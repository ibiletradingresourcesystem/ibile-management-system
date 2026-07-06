require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db();
        const collections = await db.listCollections().toArray();
        const matching = collections.filter(c => /end|eod|till/i.test(c.name)).map(c => c.name);
        console.log('Matching collections:', matching);
    } finally {
        await client.close();
    }
}
run().catch(console.error);
