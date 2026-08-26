const mongoose = require('mongoose');

const CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Shopping',
  'Transport',
  'Fuel',
  'Travel',
  'Bills & Utilities',
  'Subscriptions',
  'Rent & EMI',
  'Health',
  'Education',
  'Entertainment',
  'Personal Care',
  'Gifts & Donations',
  'Investments & Insurance',
  'Transfers',
  'Cash',
  'Fees & Charges',
  'Salary & Income',
  'Refunds',
  'Other',
];
const TYPES = ['debit', 'credit'];
const SOURCES = ['manual', 'email'];

const ExpenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    type: { type: String, enum: TYPES, default: 'debit', index: true },
    merchant: { type: String, trim: true, default: '' },
    description: { type: String, default: '' },
    category: { type: String, default: 'Other', index: true },
    account: { type: String, trim: true, default: '' }, // e.g. "HDFC ••1234"
    method: { type: String, trim: true, default: '' }, // UPI / Card / NetBanking / ATM / NEFT
    source: { type: String, enum: SOURCES, default: 'manual', index: true },
    email: {
      messageId: { type: String },
      uid: Number,
      subject: String,
      from: String,
      receivedAt: Date,
    },
    fingerprint: { type: String, index: true }, // type|amount|day|merchant — catches the same transaction alerted twice
    excluded: { type: Boolean, default: false }, // ignore in totals (e.g. transfers to own account)
    notes: { type: String, default: '' },
    tags: [{ type: String, trim: true }],
    ai: { category: String, confidence: Number, via: String },
  },
  { timestamps: true }
);

ExpenseSchema.index({ 'email.messageId': 1 }, { unique: true, sparse: true });
ExpenseSchema.index({ merchant: 'text', description: 'text', notes: 'text' });

ExpenseSchema.statics.CATEGORIES = CATEGORIES;
ExpenseSchema.statics.TYPES = TYPES;

module.exports = mongoose.model('Expense', ExpenseSchema);
