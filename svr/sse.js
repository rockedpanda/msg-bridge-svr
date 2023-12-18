const express = require('express');
const router = express.Router();
const sseLib = require('./lib/lib.sse');

/**
 * 创建一个SSE链接,具体实现在lib.sse.js中
 */
router.get('/sse_connect', sseLib.sseConnect);

module.exports = router;