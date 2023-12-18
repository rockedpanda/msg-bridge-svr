/**
 * 雪花 ID 生成器
 * Date: 2020年9月25日14:20:21
 * Version: 1.1.0
 * A function for converting hex <-> dec w/o loss of precision.
 * @description js Number最大长度不超过16位,否则会出现精度丢失的问题;有效范围0~2^53
 * 
 * 总数54位
 * 标识为 1位 固定为0(正数), 如果为1则表示负数(暂不会遇到负数)
 * 时间戳 41位 -> 到毫秒, 从2020-01-01开始计算, 可用约67年(至2087年) 
 * 设备编号(机器号+服务号) 3位 从0-7, 每个进程不同, 优先从环境变量获取本服务分配的编号, 取不到时使用随机数.
 * 毫秒内序号 10位 从0-1023, 超出则毫秒数+1
 */
 class SnowflakeID {
  constructor(options) {
      options = options || {};
      this.seq = 0;
      //机器id或任何随机数。如果您是在分布式系统中生成id，强烈建议您提供一个适合不同机器的mid。
      this.mid = (options.mid || 1) % 8; //3位
      this.bMid = this.mid.toString(2);
      while (this.bMid.length < 3) {
        this.bMid = '0' + this.bMid;
      }
      //这是一个时间偏移量，它将从当前时间中减去以获得id的前42位。这将有助于生成更小的id。
      //this.offset = options.offset || (new Date().getFullYear() - 1970) * 31536000 * 1000;
      this.offset = options.offset || 1577808000000; //统一从2020年1月1日开始作为偏移量
      this.lastTime = 0;
  }

  generate() {
      const time = Date.now();
      const bTime = (time - this.offset).toString(2);
      // get the sequence number
      if (this.lastTime == time) {
          this.seq++;
          if (this.seq > 1023) { //10位, 范围0~1023
              this.seq = 0;
              // make system wait till time is been shifted by one millisecond
              while (Date.now() <= time) {}
          }
      } else {
          this.seq = 0;
      }

      this.lastTime = time;

      let bSeq = this.seq.toString(2);
      let bMid = this.bMid;

      // create sequence binary bit
      while (bSeq.length < 10) bSeq = '0' + bSeq;

      const bid = bTime + bMid + bSeq;
      //console.log(bid, parseInt('0'+bid, 2));
      if(bid.length<53){ //53位以下是可以直接2进制转10进制的.
        return parseInt('0'+bid, 2);
      }
      let id = '';
      for (let i = bid.length; i > 0; i -= 4) {
          id = parseInt(bid.substring(i - 4, i), 2).toString(16) + id;
      }
      return this.hexToDec(id);
  }

  add(x, y, base) {
      let z = [];
      let n = Math.max(x.length, y.length);
      let carry = 0;
      let i = 0;
      while (i < n || carry) {
          let xi = i < x.length ? x[i] : 0;
          let yi = i < y.length ? y[i] : 0;
          let zi = carry + xi + yi;
          z.push(zi % base);
          carry = Math.floor(zi / base);
          i++;
      }
      return z;
  }

  /**
   * 乘以数字
   * @param {*} num
   * @param {*} x
   * @param {*} base
   */
  multiplyByNumber(num, x, base) {
      if (num < 0) return null;
      if (num == 0) return [];

      let result = [];
      let power = x;
      while (true) {
          if (num & 1) {
              result = this.add(result, power, base);
          }
          num = num >> 1;
          if (num === 0) break;
          power = this.add(power, power, base);
      }

      return result;
  }

  /**
   * 解析为数组
   * @param {*} str
   * @param {*} base
   */
  parseToDigitsArray(str, base) {
      let digits = str.split('');
      let ary = [];
      for (let i = digits.length - 1; i >= 0; i--) {
          let n = parseInt(digits[i], base);
          if (isNaN(n)) return null;
          ary.push(n);
      }
      return ary;
  }

  /**
   * 转换
   * @param {*} str
   * @param {*} fromBase
   * @param {*} toBase
   */
  convertBase(str, fromBase, toBase, legnth) {
      let digits = this.parseToDigitsArray(str, fromBase);
      if (digits === null) return null;
      let outArray = [];
      let power = [1];
      for (let i = 0; i < digits.length; i++) {
          // inletiant: at this point, fromBase^i = power
          if (digits[i]) {
              outArray = this.add(
                  outArray,
                  this.multiplyByNumber(digits[i], power, toBase),
                  toBase
              );
          }
          power = this.multiplyByNumber(fromBase, power, toBase);
      }
      let out = '';
      //设置了这里-3会返回16位的字符,如果是设置为outArray.length - 1 会返回18位的字符
      for (let i = outArray.length - 3; i >= 0; i--) {
          out += outArray[i].toString(toBase);
      }
      return out;
  }

  /**
   * 16进制=> 10进制
   * @param {*} hexStr
   */
  hexToDec(hexStr) {
      if (hexStr.substring(0, 2) === '0x') hexStr = hexStr.substring(2);
      hexStr = hexStr.toLowerCase();
      return this.convertBase(hexStr, 16, 10);
  }
}

//本服务的机器id从环境变量 SNOWFLAKE_MID 获取(10进制正整数),取不到则使用7
const SNOWFLAKE_MID = global.configInfo && global.configInfo.SNOWFLAKE_MID || process.env.SNOWFLAKE_MID;
const snid = new SnowflakeID({mid: SNOWFLAKE_MID ? parseInt(SNOWFLAKE_MID,10) : 7 });
function get(){
  return snid.generate();
}

module.exports = SnowflakeID;
module.exports.get = get;
