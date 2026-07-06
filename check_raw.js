require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function run() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db();
        const doc = await db.collection('endofdayreports').findOne({ _id: new ObjectId("6a0b4a72e7b76cd20c65a8b4") });
        console.log(JSON.stringify(doc, null, 2));
    } finally {
        await client.close();
    }
}
run().catch(console.error);
