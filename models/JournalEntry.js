import mongoose, { Schema, models } from "mongoose";
import Counter from "@/models/Counter";

const ENTRY_NUMBER_PREFIX = "JE-";
const ENTRY_SEQUENCE_KEY = "journalEntry";
const ENTRY_NUMBER_RETRY_LIMIT = 5;

const JournalLineSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    accountCode: { type: String, required: true },
    accountName: { type: String, required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    description: { type: String, default: "" },
  },
  { _id: false }
);

const JournalEntrySchema = new Schema(
  {
    entryNumber: { type: String, unique: true, required: true },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, required: true },
    lines: {
      type: [JournalLineSchema],
      validate: {
        validator: function (lines) {
          return lines && lines.length >= 2;
        },
        message: "A journal entry must have at least 2 lines",
      },
    },
    reference: { type: String, default: "" }, // e.g. "TXN-12345", "EXP-001", "PO-00123"
    referenceType: {
      type: String,
      enum: ["MANUAL", "SALE", "CREDIT_SALE", "CREDIT_PAYMENT", "EXPENSE", "PURCHASE_ORDER", "SALARY", "REFUND", "OTHER"],
      default: "MANUAL",
    },
    referenceId: { type: Schema.Types.ObjectId }, // Link to source document
    status: {
      type: String,
      enum: ["DRAFT", "POSTED", "VOIDED"],
      default: "DRAFT",
    },
    location: { type: String, default: "" },
    totalDebit: { type: Number, default: 0 },
    totalCredit: { type: Number, default: 0 },
    postedAt: { type: Date },
    voidedAt: { type: Date },
    voidReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String },
  },
  { timestamps: true }
);

// Pre-save: calculate totals and validate debits = credits
JournalEntrySchema.pre("save", function (next) {
  const totalDebit = this.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = this.lines.reduce((sum, l) => sum + (l.credit || 0), 0);

  // Round to 2 decimal places to avoid floating point issues
  this.totalDebit = Math.round(totalDebit * 100) / 100;
  this.totalCredit = Math.round(totalCredit * 100) / 100;

  if (this.status === "POSTED" && this.totalDebit !== this.totalCredit) {
    return next(new Error(`Debits (${this.totalDebit}) must equal Credits (${this.totalCredit})`));
  }

  next();
});

JournalEntrySchema.index({ date: -1 });
JournalEntrySchema.index({ status: 1 });
JournalEntrySchema.index({ referenceType: 1 });
JournalEntrySchema.index({ "lines.account": 1 });

const JournalEntry = models.JournalEntry || mongoose.model("JournalEntry", JournalEntrySchema);

function formatJournalEntryNumber(sequence) {
  return `${ENTRY_NUMBER_PREFIX}${String(sequence).padStart(4, "0")}`;
}

function isEntryNumberDuplicateError(error) {
  return error?.code === 11000 && Boolean(error?.keyPattern?.entryNumber || error?.message?.includes("entryNumber_1"));
}

async function getHighestJournalEntrySequence() {
  const [result] = await JournalEntry.aggregate([
    {
      $match: {
        entryNumber: {
          $type: "string",
          $regex: `^${ENTRY_NUMBER_PREFIX}[0-9]+$`,
        },
      },
    },
    {
      $project: {
        sequence: {
          $toInt: {
            $substrCP: [
              "$entryNumber",
              ENTRY_NUMBER_PREFIX.length,
              {
                $subtract: [{ $strLenCP: "$entryNumber" }, ENTRY_NUMBER_PREFIX.length],
              },
            ],
          },
        },
      },
    },
    { $sort: { sequence: -1 } },
    { $limit: 1 },
  ]);

  return result?.sequence || 0;
}

export async function getNextJournalEntryNumber() {
  for (let attempt = 0; attempt < ENTRY_NUMBER_RETRY_LIMIT; attempt += 1) {
    const existingCounter = await Counter.findById(ENTRY_SEQUENCE_KEY).lean();

    if (!existingCounter) {
      const highestSequence = await getHighestJournalEntrySequence();

      try {
        await Counter.create({ _id: ENTRY_SEQUENCE_KEY, seq: highestSequence });
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }
      }

      continue;
    }

    const updatedCounter = await Counter.findOneAndUpdate(
      { _id: ENTRY_SEQUENCE_KEY },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return formatJournalEntryNumber(updatedCounter.seq);
  }

  throw new Error("Failed to reserve a journal entry number");
}

export async function createJournalEntry(entryPayload) {
  for (let attempt = 0; attempt < ENTRY_NUMBER_RETRY_LIMIT; attempt += 1) {
    try {
      return await JournalEntry.create({
        entryNumber: await getNextJournalEntryNumber(),
        ...entryPayload,
      });
    } catch (error) {
      if (!isEntryNumberDuplicateError(error) || attempt === ENTRY_NUMBER_RETRY_LIMIT - 1) {
        throw error;
      }
    }
  }

  throw new Error("Failed to create journal entry");
}

export default JournalEntry;
