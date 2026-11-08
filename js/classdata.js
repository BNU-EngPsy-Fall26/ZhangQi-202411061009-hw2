/* ============================================================
   classdata.js —— 全班课堂数据（课程注意实验室）
   ------------------------------------------------------------
   重要：/api/class/summary 接口**未开放 CORS**，浏览器从 GitHub Pages
   直接请求会被跨域拦截（Failed to fetch）。因此采用：
     ① 首读同源静态快照 data/class_summary.json（随站点部署，零跨域）
     ② 若同源文件缺失，再尝试实时接口（仅在接口将来开放 CORS 时生效）
   静态快照由 tools 脚本定期从课程接口抓取，内容为三个实验的匿名汇总：
     inattention = W5 · 专注计数
     flanker     = W6 · 冲突（相邻位置）速测
     cm          = W7 · 图形比例估计（估一估）
   ============================================================ */
"use strict";

const CLASSDATA = {
  LAB: "https://attention-lab-production.up.railway.app",
  cache: {},
  lastError: null,
  loadedAll: false,

  /** 快照路径：自适应页面所在目录
   *  （results.html 在根目录；实验页在 experiments/ 下，需要 ../ 前缀） */
  get SNAPSHOT() {
    const inSub = /\/experiments\//.test(location.pathname);
    return (inSub ? "../" : "") + "data/class_summary.json";
  },

  /** 载入静态快照（同源，无 CORS 问题），一次性读入内存 */
  async loadSnapshot() {
    if (this.loadedAll) return;
    try {
      const r = await fetch(this.SNAPSHOT, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const txt = (await r.text()).replace(/^\uFEFF/, "");
      const j = JSON.parse(txt);
      if (j && j.exps) {
        Object.keys(j.exps).forEach(k => { this.cache[k] = j.exps[k]; });
        this.snapshotAt = j.fetched_at || null;
      }
      this.loadedAll = true;
    } catch (e) {
      this.lastError = "静态快照读取失败：" + e.message;
      this.loadedAll = true;   // 避免反复重试
    }
  },

  /** 取某个课程实验的全班汇总 */
  async summary(expId) {
    if (this.cache[expId]) return this.cache[expId];
    await this.loadSnapshot();
    if (this.cache[expId]) return this.cache[expId];

    // 兜底：尝试实时接口（若将来开放 CORS 即可用）
    try {
      const url = `${this.LAB}/api/class/summary?exp=${encodeURIComponent(expId)}&input=keyboard`;
      const r = await fetch(url, { cache: "no-store", mode: "cors" });
      if (r.ok) {
        const j = await r.json();
        if (j && j.data) { this.cache[expId] = j.data; return j.data; }
      }
    } catch (e) {
      this.lastError = `实时接口不可用（CORS 限制）：${e.message}`;
    }
    return null;
  },
};
