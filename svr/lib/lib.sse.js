/**
 * 实现到单个客户端的唯一的SSE推送通道, Express框架中间件
 */

//所有当前已经建立的链接对象,整体是一个map,
const CLIENT_SOCKET_MAP = {}; //{client_id:Socket}, 每个client_id复用同一个链接(一个浏览器保留一个,用户退出登录后自动断开)
const zlib = require('zlib'); //消息压缩gzip
const mq_cache = require('../lib/lib.mq_cache'); //消息缓存队列,缓存最后1s内的消息,避免SSE重连期间的消息丢失问题.
const CLOSE_SSE_AFTER_DATA_SEND = global.configInfo.SSE_AS_PULL==='1';//发送数据后立即重建SSE,避免消息被缓存的情况(如nginx配置了错误的缓存机制).(本质为用长轮询替代SSE)

let snowflakeId = require('./lib.snowflake').get;//雪花算法

/** 【中间件主入口】
 * 创建一个SSE链接并将res记录到socket数组中
 * @param {HTTPRequest} req http请求, 其url中需要携带 client_id作为客户端的唯一标识
 * @param {HTTPResponse} res http响应
 * @param {Function} next 中间件next
 * @returns 
 */
function sseConnect(req, res, next) {
  /* let cookie = req.header.cookie;
  if(!cookie){
    res.status(403).send('认证失败'); //移除认证, 如需认证, 请在此中间件之前额外配置单独的认证用的中间件.
    return;
  } */
  let client_id = req.query.client_id;
  let last_msg_id = parseInt(req.header('last-event-id')||'0', 10); //SSE客户端会自动携带上一次消息的id(如果存在),可以根据此id查询有无缓存消息
  //常规模式下, 采用SSE或者长轮询方案
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Transfer-Encoding': 'identity',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  addSocket(res, client_id, last_msg_id);
  sendLastestMsgAndClose(res, client_id, last_msg_id, !CLOSE_SSE_AFTER_DATA_SEND);
}

/**
 * 根据client_id向该客户端发送消息
 * @param {String} client_id client_id
 * @param {Object} msg 待发送的消息体, JSON对象
 */
function sendMsg(client_id, msg) {
  if(!client_id){
    return; //没有指定client_id,则跳过
  }
  const targetSocket = CLIENT_SOCKET_MAP[client_id] || {};
  if (targetSocket.isClose !== true) { //兼容没有该客户端, 或者已关闭等特殊状态
    return false;
  }
  if (msg && !msg.msg_id) {
    msg.msg_id = snowflakeId();
  }
  msg = mq_cache.add(msg); //加入到数据缓存
  if (!!msg.client_id && msg.client_id !== '*') {
    if (targetSocket.client_id !== msg.client_id) {
      // console.log('client_id不匹配--------')
      return false; //与消息中携带的client_id不匹配时,跳过
    }
  }
  sendMsgToRes(targetSocket, msg);
  return true;
}

function sendMsgToClientId(client_id, msg){
  if(!client_id || client_id=='*'){ //暂不支持client_id为*的情况, 后续再扩展
    return false;
  }
  //现根据client_id查找具体哪一个
  return sendMsg(client_id, msg);
}

/**
 * 向某个链接发送消息
 * @param {httpResponse} res 待接收消息的response对象
 * @param {Object} msg 待发送的消息体
 * @param {Number} retry 客户端断开后的重连等待时间,默认为100(毫秒)
 * @param {Object} options 其他参数,doNotClose为true时,不主动关闭连接,由其他地方负责关闭

 */
 function sendMsgToRes(res, msg, retry=100, options={}) {
  let type = msg.msgType || 'msg';
  const isRealMsg = msg && type!=='sse_connected'; //有真实内容的消息,不是心跳或sse_connected
  if(isRealMsg){
    msg = mq_cache.add(msg);
  }
  let msg_id = msg.msg_id || snowflakeId();
  if(msg instanceof Buffer){
    //TODO: 原始二进制的数据,待实现
  }else if(typeof msg !== 'string'){
    if(!msg.msg_id){
      msg.msg_id = msg_id;
    }
    msg = JSON.stringify(msg);
  }
  if(msg.indexOf('\n\n')!==-1||msg.length>2048){ //长度大于2K或者如果含有特殊字符\n\n,则转base64后传输; 不含有特殊字符的直接传
    // msg='base64:'+ Buffer.from(unescape(encodeURIComponent(msg))).toString('base64'); 
    //后端转base64不需要encodeURIComponent,前端仍然需要
    msg='base64:gzip:'+ zlib.gzipSync(msg).toString('base64');
  }else if(msg instanceof Buffer){
    msg='base64:'+msg.toString('base64');
  }
  let text = 'retry:'+retry+'\n\n'+'event: '+type+'\nid: '+msg_id+'\ndata:'+Date.now()+':'+msg+' '+'\n\n';
  console.log('发送SSE消息:',text, CLOSE_SSE_AFTER_DATA_SEND);
  res.last_msg_id = msg_id; //目前服务端记录last_msg_id仅是为了定位用,暂没有用于逻辑控制.
  res.write(text);
  if(!options.doNotClose && CLOSE_SSE_AFTER_DATA_SEND && (isRealMsg || (Date.now() - res.start_time > 55000))){ //超过55s则断开一次,目的是防止网络中间有nginx等不可控环节导致数据被缓存挤压,后续这部分的设计迁移到SSE_AS_PULL开关中
    //有真实消息(非心跳)则立即断开,
    //无真实消息,则大于55s才会断开(确保心跳和延时控制下发)
    res.end();
    removeSocket(res);
  }
}

/* 消息序列化
  举例: msg:1629807202667:{a:1,b:2} 或者
  举例: msg:1629807202667:base64:xxxxxxxx 
  举例: msg:1629807202667:base64:gzip:xxxxxxxx 
*/
function encodeMsg(msg){
  let msg_id = msg.msg_id || snowflakeId();
  if(msg instanceof Buffer){
    //TODO: 原始二进制的数据,待实现
  }else if(typeof msg !== 'string'){
    if(!msg.msg_id){
      msg.msg_id = msg_id;
    }
    msg = JSON.stringify(msg);
  }
  if(msg.indexOf('\n\n')!==-1||msg.length>2048){ //长度大于2K或者如果含有特殊字符\n\n,则转base64后传输; 不含有特殊字符的直接传
    // msg='base64:'+ Buffer.from(unescape(encodeURIComponent(msg))).toString('base64'); 
    //后端转base64不需要encodeURIComponent,前端仍然需要
    msg='base64:gzip:'+ zlib.gzipSync(msg).toString('base64');
  }else if(msg instanceof Buffer){
    msg='base64:'+msg.toString('base64');
  }
}

// function write(res, msg){
//   let text = 'retry:'+retry+'\n\n'+'event: '+type+'\nid: '+msg_id+'\ndata:'+Date.now()+':'+msg+' '+'\n\n';
// }

/**
 * 根据客户端id或连接移除一个客户端缓存
 * @param {String|HTTPResponse} res 待关闭的response或者其client_id
 */
function removeSocket(res){
  let client_id = res;
  if(typeof res !== 'string' && res.client_id){
    client_id = res.client_id;
  }
  if(CLIENT_SOCKET_MAP[client_id]){
    delete CLIENT_SOCKET_MAP[client_id];
  }
  //如果有缓存消息,会过10s自动清理,这里不再手动清理.同时也避免重连间歇内的数据丢失.
}

/**
 * 将一个httpResponse对象记录到浏览器id对应的socket中
 * @param {HTTPResponse} socket 具体的httpResponse对象
 * @param {String} client_id 浏览器id
 */
function addSocket(socket, client_id, last_msg_id){
  if(!CLIENT_SOCKET_MAP[client_id]){
    CLIENT_SOCKET_MAP[client_id] = socket;
  }else{
    if(CLIENT_SOCKET_MAP[client_id].isClose){
      console.log('旧的连接已经断开,直接覆盖即可');
      //CLIENT_SOCKET_MAP[client_id].end();
    }else{
      let retry = randomTime();
      CLIENT_SOCKET_MAP[client_id].write('retry: '+retry+'\nevent: msg\ndata:Other_SSE_Connected\n\n');
      CLIENT_SOCKET_MAP[client_id].end();
    }
    //已经存在对应的连接, 放弃或者覆盖：【覆盖】 
    CLIENT_SOCKET_MAP[client_id] = socket;
  }
  socket.client_id = client_id;
  socket.start_time = Date.now();
  socket.last_msg_id = last_msg_id || 0;

  sendMsgToRes(socket, '连接成功'); //发一个连接成功的常规消息,以便触发前端的e_sse_init
  
  socket.on('close', function(){ //链接断开后从数组中移除
    console.log('移除断开的SSE链接:client_id:',client_id);
    removeSocket(client_id);
  });
}

/**
 * 查询到该请求对应的最后数据,响应数据后关闭;
 */
function sendLastestMsgAndClose(res, client_id, last_msg_id, doNotClose=false){
  let msgList = getMsgListForClient({client_id, last_msg_id});
  let hasMsg = true;
  if(msgList.length===0){
    hasMsg = false;
    msgList.push('连接成功');//补充一个默认消息
  }
  msgList.forEach(x=>sendMsgToRes(res, x, 100, {doNotClose:true}));
  let retry = randomTime(); //retry时间选10ms到210ms内的随机数,这个是长轮询的时间间隔
  res.write('retry: '+retry+'\nevent: msg\ndata:\n\n');
  if(!doNotClose && hasMsg){ //有真实消息,且模式为长轮询,则下发消息后关闭.
    res.end();
    removeSocket(res);
  }
}

//查询缓存了的消息
function getMsgListForClient({client_id, last_msg_id=0}){
  if(last_msg_id===0){
    return [];
  }
  let list = mq_cache.query(last_msg_id, {client_id});
  //console.log('查询到缓存消息: ', last_msg_id, list.map(x=>x.msg_id));
  return list;
}

//给定一个client_id,立即发送一次重连消息
function reconnectClient(client_id){
  console.log('查询并关闭如下连接:', client_id);
  let res = CLIENT_SOCKET_MAP[client_id];
  let t = randomTime();
  res.write('retry:'+t+'\n\nevent: msg\nid: '+snowflakeId()+'\ndata:'+Date.now()+':自动重连\n\n');
  res.end();
  removeSocket(res);
}

/**
 * 清理已经断开的连接, 收尾手段, 用于定时清理
 */
function clearClosedSocket(){
  Object.keys(CLIENT_SOCKET_MAP).forEach(k=>{
      //由于涉及到从数组中删除元素,会导致length变化,故采用从后向前遍历的方式
      let socket = CLIENT_SOCKET_MAP[k];
      if(socket.isClose){
        delete CLIENT_SOCKET_MAP[k];
      }
  });
}
//每10分钟清理一次过期连接
setInterval(clearClosedSocket, 600*1000);

/**
 * 向所有连接发送心跳信息
 */
function sendHeartBeat() {
  Object.values(CLIENT_SOCKET_MAP).forEach(x => {
    sendMsgToRes(x, ''); //心跳是空内容, 心跳消息不需要加入到缓存
  });
}
setInterval(sendHeartBeat, 1000*60); //由60s一次下发心跳

//返回一个10-210ms的随机数, 方便离散化retry时间,避免并发
function randomTime(){
  return 10 + (Math.random()*200>>0);
}

/* 测试用, 每3s发一个特定消息
function demo(){
  Object.keys(CLIENT_SOCKET_MAP).forEach(clientId=>{
    console.log('GO_NOW_111');
    sendMsgToRes(CLIENT_SOCKET_MAP[clientId], {msg:'GO_NOW_111'+Date.now(),client_id:'*'});
  });
}
setInterval(demo, 3000);
*/

exports.sseConnect = sseConnect;
exports.sendMsg = sendMsg;
exports.sendMsgToClientId = sendMsgToClientId;
exports.reconnectClient = reconnectClient;
