'use strict';
// sidecar/lib/concurrency.js
//
// 信号量：限制 Sharp 并发操作数，防止 OOM
//
// Sharp 内部使用 libvips 线程池，但大量并发解码 RAW/HEIC 仍会消耗大量内存。
// 通过信号量确保同时最多 MAX_CONCURRENT 个重量级操作在运行。
//
// 典型配置：
//   thumbnail  → Semaphore(3)  每次最多同时解码 3 张图
//   decode     → Semaphore(1)  原图解码是内存密集型操作，串行更安全
//   metadata   → Semaphore(8)  仅读头部，可高并发

class Semaphore {
  /**
   * @param {number} limit 最大并发数
   */
  constructor(limit) {
    this._limit   = limit;
    this._running = 0;
    this._queue   = [];
  }

  /**
   * 获取一个槽位（若已满则等待）
   * @returns {Promise<() => void>} release 函数，调用后释放槽位
   */
  acquire() {
    return new Promise((resolve) => {
      const tryRun = () => {
        if (this._running < this._limit) {
          this._running++;
          resolve(() => {
            this._running--;
            if (this._queue.length > 0) {
              // 唤醒队列中等待最久的请求
              const next = this._queue.shift();
              next();
            }
          });
        } else {
          this._queue.push(tryRun);
        }
      };
      tryRun();
    });
  }

  /**
   * 便捷包装：自动获取/释放槽位
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async run(fn) {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** 当前正在运行的操作数 */
  get running() { return this._running; }
  /** 当前等待中的操作数 */
  get pending() { return this._queue.length; }
}

// 各命令的并发限制
const thumbSem    = new Semaphore(3);  // 缩略图生成
const decodeSem   = new Semaphore(1);  // 原图解码（内存密集）
const metaSem     = new Semaphore(8);  // 元数据读取（轻量）

module.exports = { Semaphore, thumbSem, decodeSem, metaSem };
