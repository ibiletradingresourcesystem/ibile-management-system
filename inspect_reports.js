require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db();
        const collection = db.collection('endofdayreports');
        
        const reports = await collection.find({ closedAt: { $ne: null } })
            .sort({ closedAt: -1 })
            .limit(200)
            .toArray();

        let stats = {
            totalInspected: reports.length,
            statusCounts: {},
            diffLessThanPoint01: 0,
            notReconciledButClose: [],
            varianceRuleMistmatch: [],
            fmtMatchNotReconciled: [],
            nonCashTendersCheck: {
                countWithNonCash: 0,
                formulaSuspects: []
            }
        };

        const nf = new Intl.NumberFormat();

        reports.forEach(r => {
            const status = r.status || 'UNKNOWN';
            stats.statusCounts[status] = (stats.statusCounts[status] || 0) + 1;

            const physical = Number(r.physicalCount || 0);
            const expected = Number(r.expectedClosingBalance || 0);
            const variance = Number(r.variance || (physical - expected));
            const diff = Math.abs(physical - expected);

            if (diff < 0.01) stats.diffLessThanPoint01++;

            if (status !== 'RECONCILED' && diff < 0.01) {
                if (stats.notReconciledButClose.length < 5) {
                    stats.notReconciledButClose.push({
                        id: r._id, physical, expected, status, variance: r.variance, diff
                    });
                }
            }

            // Rule: |variance| < 1 => RECONCILED (as per prompt hint)
            const expectedStatus = Math.abs(variance) < 1 ? 'RECONCILED' : 'VARIANCE';
            if (status !== expectedStatus) {
                if (stats.varianceRuleMistmatch.length < 5) {
                    stats.varianceRuleMistmatch.push({
                        id: r._id, physical, expected, status, variance, expectedStatus
                    });
                }
            }

            if (nf.format(physical) === nf.format(expected) && status !== 'RECONCILED') {
                if (stats.fmtMatchNotReconciled.length < 5) {
                    stats.fmtMatchNotReconciled.push({
                        id: r._id, physical, expected, status
                    });
                }
            }

            // Non-cash tenders check
            // Most reports might have sales breakdown. 
            // We want to see if expectedClosingBalance matches total sales while physical is only cash.
            // Often expectedClosingBalance = opening + sales - expenses.
            // If sales contains cards but physical only counts cash drawer, it will show variance.
            const hasNonCash = r.tenders && r.tenders.some(t => t.name && !/cash/i.test(t.name) && Number(t.amount) > 0);
            if (hasNonCash) {
                stats.nonCashTendersCheck.countWithNonCash++;
                // If variance is roughly equal to non-cash amount, the formula might be wrong
                const nonCashTotal = r.tenders.filter(t => !/cash/i.test(t.name)).reduce((sum, t) => sum + Number(t.amount), 0);
                if (Math.abs(Math.abs(variance) - nonCashTotal) < 1 && stats.nonCashTendersCheck.formulaSuspects.length < 3) {
                     stats.nonCashTendersCheck.formulaSuspects.push({
                         id: r._id, variance, nonCashTotal, physical, expected
                     });
                }
            }
        });

        console.log(JSON.stringify(stats, null, 2));
    } finally {
        await client.close();
    }
}
run().catch(console.error);
