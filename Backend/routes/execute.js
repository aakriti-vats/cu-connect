// IDE code-execution route. Requires a valid token (the app user is logged in).
//
// SECURITY: lib/runner.js is an UNSANDBOXED local runner — it spawns real
// interpreters/compilers on the app host. It must never face the public
// internet as-is. This route is only mounted when IDE_ENABLED is true (off by
// default in production; see config.js), and it double-checks the flag at
// request time. In production, wire this to a sandboxed executor (Judge0/Docker)
// before flipping IDE_ENABLED on.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { runCode } = require('../lib/runner');
const { IDE_ENABLED } = require('../config');

const router = express.Router();

// POST /api/execute  { language, code, stdin }
router.post('/execute', requireAuth, async (req, res) => {
  if (!IDE_ENABLED) {
    return res.status(503).json({
      output: 'The online IDE is disabled in this environment.',
      ok: false,
    });
  }
  const { language, code, stdin } = req.body || {};
  if (!language || typeof code !== 'string') {
    return res.status(400).json({ error: 'language and code are required.' });
  }
  try {
    const result = await runCode({ language, code, stdin });
    res.json(result);
  } catch (err) {
    res.status(500).json({ output: 'Execution failed: ' + err.message, ok: false });
  }
});

module.exports = router;
