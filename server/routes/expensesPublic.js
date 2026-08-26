const router = require('express').Router();
const gmail = require('../services/gmail');
const wrap = require('../middleware/asyncHandler');

// Google redirects the browser here after the consent screen — no bearer token on a redirect,
// so this route is public; the signed `state` (15-min JWT issued to the logged-in user) is the guard.
router.get(
  '/gmail/callback',
  wrap(async (req, res) => {
    try {
      const email = await gmail.handleCallback(req);
      res.redirect(`/expenses?gmail=connected&email=${encodeURIComponent(email)}`);
    } catch (e) {
      res.redirect(`/expenses?gmail=error&message=${encodeURIComponent(e.message)}`);
    }
  })
);

module.exports = router;
