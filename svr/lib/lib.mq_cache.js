/**
 * 临时消息缓存池
 */
let _ = require('underscore');
let snowflakeId = require('./lib.snowflake').get;
let cache = [];
const EXPIRE_TIME = 10000;//默认过期时间10s,10s后自动舍弃.
let lastId = 0;

//将一个消息加入到队列中
function add(msg){
  if(!msg){
    return;
  }
  if(msg.msgType=='log'){
    return msg;
  }
  if(!msg.msg_id){
    msg.msg_id = snowflakeId();
  }
  if(!msg.expire){
    msg.expire = Date.now()+EXPIRE_TIME;
  }
  if(cache.some(x=>x.msg_id===msg.msg_id)){
    //console.log('DO NOT CACHE TWICE');
    return msg;
  }
  cache.push(msg);
  //console.log('>>>>>>>>>>>>>>', cache.map(x=>x.msg_id));
  lastId = Math.max(msg.msg_id, lastId);
  return msg;
}

//根据msg_id移除一个元素
function removeById(msg_id){
  let itemIndex = cache.findIndex(x=>x.msg_id===msg_id);
  if(itemIndex===-1){
    return true;
  }
  cache.splice(itemIndex,1);
  return true;
}


//清理过期的数据
function clear(){
  if(cache.length===0){
    return;
  }
  let now = Date.now();
  for(let i=cache.length-1;i>-1;i--){ //由于要删除数据,从后向前循环
    if(cache[i].expire < now){
      cache.splice(i,1);
    }
  }
}

//根据条件查询有没有可用的消息
function query(last_msg_id, filter={}){
  clear(); //先清理过期数据
  let list = cache.filter(x=>x.msg_id > last_msg_id);
  if(list.length===0){
    return list;
  }
  let func = function(x){
    return Object.keys(filter).every(k=>{
      return x[k] == filter[k];
    });
  };
  return list.filter(func);
}

exports.add = add;
exports.removeById = removeById;
exports.clear = clear;
exports.query = query;
