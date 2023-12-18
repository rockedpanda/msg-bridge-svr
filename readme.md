# 基于SSE的消息通知

## 目的
基于SSE通道, 实现简单的在线消息推送机制。实现消息类型注册，监听的单向数据推送。较Websocket或Socket.io方案更为简化。

由于时SSE方式的长连接，客户端使用SharedWorker方式解决浏览器端的并发限制问题。

## 设计思路

整体分为后端模块和前端sdk两部分。
客户端sdk初始化后, 向服务端上报要监听的数据范围(http+post请求); 监听成功后,服务端在生成对应消息时会将该消息返回给客户端,并触发msg事件;

### 后端模块
后端模块以connect/express中间件方式存在, 提供对路由的监听处理, 方便挂载路由和处理。

使用样例如下：
```javascript
let ssemsg = require('ssemsg');
app.use('/msg', new SseMsg());
```

```mermaid
graph TB
A[程序启动] --> B[有连接创建] --> C[更新连接队列]
B --创建连接成功消息 --> 发送消息
D1[有注册信息上报] --> 查找连接 --> C
D2[有反注册信息上报] --> 查找连接 --> C
S1[有消息发送] --> C2[根据消息信息查找连接队列] --逐个--> 发送消息
E[有链接断开] --> C
subgraph 连接队列
C
C2
end

```

数据结构设计:



### 前端sdk
前端sdk以独立js脚本方式存在,使用方式如下:

```javascript
// <script src="ssemsg.min.js"></script>
let url = BASE_URL + '/msg';
let sseMsg = new SseMsg(url, clientId=null, pageId=uuid());

/**
 * 向服务器声明要监听的范围,
sseMsg.reg('监听范围',function(msg){ //监听的回调函数
  //do something with msg
});
*/
sseMsg.reg('event:*', callBack1);
sseMsg.reg('sse:room:*', callBack2);
sseMsg.reg('*', callBack3);

sseMsg.reg('broswer:*', callBack4); //注册浏览器内部各网页间的消息

sseMsg.reg('system:*', callBackDefault) //sdk会默认监听system:*类型的所有消息,无需业务层面处理,此函数在new完毕后自动执行
```


```mermaid
graph TB
新页面打开 --> sdk初始化 --> A1{已存在共享链接} --否--> 建立服务器连接 --> 注册监听类型 --> A[监听消息]
A1 --是--> 复用链接 --> A
S1[有新消息] --> A --触发回调--> 执行消息处理

连接断开 --> 延迟0.5s重试三次 --> 延迟10s重试三次 -->延迟1min重试无数次 --> 建立服务器连接

页面关闭 --> sdk析构 --> 反注册监听类型


```


服务端单个消息仅对单个clientId投送一次;
单个客户端收到后给多个页面每个投送0~1次,共计0~N次;



客户端分为运行在页面内的sdk + 运行在SharedWorker的连接信息两部分, 

* SharedWorker部分仅负责建立连接/取消连接/处理连接异常/重连/转发消息到所有sdk
* sdk部分负责创建SharedWorker/向服务器注册/向服务端反注册/监听来自SharedWorker的消息/



## 其他降级方案

|  连接类型   | 用途  | 注意事项 | 应用场景 |
|  ----  | ----  | ---- | ---- |
| SSE  | 近实时 | 默认类型 | 默认使用, 推荐 |
| 直接关闭并立即重连的SSE  | 低延迟 | 发送并立即重连,模拟长轮询;可规避服务器缓存问题导致的下发受阻;一般重来你时间设置为10ms | 网络投送被缓存时使用|
| 直接关闭并延迟重连的SSE | 高延迟 | 有无消息均立即关闭, 重连时间固定为500ms, 容忍高延迟, 需确保消息最终到达 | 浏览器不支持SharedWorker时使用|

降级方案仍采用SSE, 完全由服务端通过控制retry时间和是否关闭连接来控制模拟成长轮询或短轮询.
长轮询 = 有消息时立即发送并关闭, retry:10
短轮询 = 有无消息均立即发送并关闭, retry:500

长轮询和短轮询两种降级方案均存在消息缓冲池, 需要补充该机制.



```mermaid
graph TB
新消息产生 --> 加入消息缓冲池 --> 查找客户端 --> 投送消息 --> 为该客户端标记最后投递msgId
新连接建立 --得到clientId--> 查询该客户端msgId --> 到消息缓冲池查找消息 --> 投递消息

subgraph 消息查询机制
新消息事件 --> A[根据消息类型+客户端id+监听条件+]



```