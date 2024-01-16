const path = require('path');
global.packageInfo = require(path.resolve(__dirname,'../package.json'));
global.configInfo = global.packageInfo.config;
const express = require('express');
const app = express();
app.disable('x-powered-by');
const bodyParser = require('body-parser');

let server = null;
if(/\d+\.\d+\.\d+\.\d+:\d+/.test(configInfo.port)){ //带有ip地址的情况,实现仅绑定到127.0.0.1等情况
  let port = configInfo.port.split(':')[1];
  server = app.listen(+port, configInfo.port.split(':')[0]);
}else{
  server = app.listen(+configInfo.port);
}
server.setTimeout(600000);//接口超时时间改为10分钟
console.log('listenning on '+configInfo.port);
app.use(express.static(path.resolve(__dirname,'../public'), {maxAge:300*1000}))

app.post('/sse/*',bodyParser.json({limit:'200mb'}));
app.use('/sse/*',bodyParser.urlencoded({ extended: false }));

app.use('/sse', require('./sse'));

//info:在自定义路由中间件的后面，紧跟404异常处理
app.use(function(req, res, next) {
  console.log('404: ', req.method, req.url);
  res.status(404).send({error_code:404,msg:`nodesvr接口资源未找到！`,data:req.url});
});

//info:启用全局异常处理中间件
app.use(function(err, req, res, next) {
  //info:当使用view视图时，需要向客户端视图模板传参数
  //info:记录错误日志，并且在研发环境下，打印错误的详细堆栈信息
  var errorInfo = err; //req.app.get('env') === 'development' ? err : {};
  errorInfo.error_code=err.stats || 500;
  errorInfo.msg=(err.msg || '服务器内部错误，请联系管理员！')+' '+(err.stack||'').split('\n')[0];
  console.error(`error_msg:${errorInfo.msg}  error_stack:${err.stack}`);
  //info:设置返回数据
  res.status(errorInfo.error_code).send({error_code:500,msg:errorInfo.msg,data:null});
  return;
});
