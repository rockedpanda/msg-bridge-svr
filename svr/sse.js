const express = require('express');
const router = express.Router();
const sseLib = require('./lib/lib.sse');

/**
 * 创建一个SSE链接,具体实现在lib.sse.js中
 */
router.get('/sse_connect', sseLib.sseConnect);

/**
 * 根据client_id发送一个消息到指定的浏览器
 * POST请求, body格式为: {client_id:'xxxxxx', msg:{消息具体内容}}
 * //TODO: 限制或校验发送来源, 识别消息格式
 */
router.post('/send_msg', function(req, res, next){
  let {client_id='', msg=null} = req.body;
  if(!client_id){
    return {error_code:1,msg:'参数格式不合法,请检查client_id',data:false};
  }
  let ans = sseLib.sendMsgToClientId(client_id, msg);
  return {error_code:0, msg:ans?'消息发送成功' :'消息发送失败', data: ans};
});


module.exports = router;