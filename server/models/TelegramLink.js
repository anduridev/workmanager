const mongoose = require('mongoose');

/** A support client (Paybitz, Global Bridge, …) and the Telegram group linked to it. */
const TelegramLinkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true }, // client name shown in the list
    chatId: { type: String, default: '' }, // Telegram dialog id ('' = not linked yet)
    chatTitle: { type: String, default: '' },
    chatUsername: { type: String, default: '' }, // public @username when the group has one (for t.me links)
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TelegramLink', TelegramLinkSchema);
