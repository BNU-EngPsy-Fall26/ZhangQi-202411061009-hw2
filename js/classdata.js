/* ============================================================
   classdata.js —— 全班课堂数据（课程注意实验室）
   ------------------------------------------------------------
   · 登录：POST /api/login {student_id, name} → token（用于标识身份）
   · 全班汇总：GET /api/class/summary?exp=<id>&input=keyboard
     对应课程「我的结果」页里每个实验的「查看结果」所展示的全班数据
   · 结果缓存于 sessionStorage（同一会话只请求一次）
   · 课程实验代号：
       inattention = W5 · 专注计数（默数目标次数）
       flanker     = W6 · 冲突（相邻位置）flanker 速测
       cm          = W7 · 图形比例估计（估一估）
   ============================================================ */
"use strict";

const CLASSDATA = {
  LAB: "https://attention-lab-production.up.railway.app",
  // 课程要求的身份信息（登录后读取全班结果）
  CRED: { student_id: "202411061009", name: "张琪" },
  token: null,
  cache: {},
  lastError: null,

  /** 登录取得 token */
  async login() {
    if (this.token) return this.token;
    try {
      const r = await fetch(this.LAB + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.CRED),
        cache: "no-store",
      });
      const j = await r.json();
      if (j && j.ok) { this.token = j.token; return this.token; }
      this.lastError = "登录失败：" + (j && j.msg || "未知原因");
    } catch (e) {
      this.lastError = "登录请求失败：" + e.message;
    }
    return null;
  },

  /** 取某个课程实验的全班汇总（带缓存与重试） */
  async summary(expId, retry = 1) {
    if (this.cache[expId]) return this.cache[expId];

    // 会话级缓存
    try {
      const cached = sessionStorage.getItem("alab_class_" + expId);
      if (cached) {
        const d = JSON.parse(cached);
        this.cache[expId] = d;
        return d;
      }
    } catch (_) { }

    await this.login();

    for (let i = 0; i <= retry; i++) {
      try {
        const url = `${this.LAB}/api/class/summary?exp=${encodeURIComponent(expId)}&input=keyboard`;
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        if (j && j.data) {
          this.cache[expId] = j.data;
          try { sessionStorage.setItem("alab_class_" + expId, JSON.stringify(j.data)); } catch (_) { }
          return j.data;
        }
        throw new Error((j && j.msg) || "返回数据为空");
      } catch (e) {
        this.lastError = `${expId} 读取失败：${e.message}`;
        if (i < retry) await new Promise(s => setTimeout(s, 400));
      }
    }
    return null;
  },

  /** 清空缓存（调试用） */
  clear() {
    this.cache = {};
    Object.keys(sessionStorage)
      .filter(k => k.startsWith("alab_class_"))
      .forEach(k => sessionStorage.removeItem(k));
  },
};
