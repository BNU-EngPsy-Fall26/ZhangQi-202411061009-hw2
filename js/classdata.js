/* ============================================================
   classdata.js —— 全班课堂数据（课程注意实验室）
   ------------------------------------------------------------
   · 登录：POST /api/login {student_id, name} → token
   · 全班汇总：GET /api/class/summary?exp=<id>&input=keyboard
     该接口公开可读（实测无凭证返回 200），但仍按作业要求先登录
   · 缓存于 sessionStorage，避免每次重复请求
   · 课程实验代号映射：
       inattention → 实验1 非注意盲（十字计数范式）
       flanker     → 实验2 经典 Flanker
       cm          → 实验3 C&M 图形知觉
   ============================================================ */
"use strict";

const CLASSDATA = {
  LAB: "https://attention-lab-production.up.railway.app",
  // 课程要求的身份信息（用于登录读取全班数据）
  CRED: { student_id: "202411061009", name: "张琪" },
  token: null,
  cache: {},                    // { expId: summaryData }

  /** 登录取得 token（失败也能继续，因为 summary 接口公开） */
  async login() {
    if (this.token) return this.token;
    try {
      const r = await fetch(this.LAB + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.CRED),
      });
      const j = await r.json();
      if (j && j.ok) { this.token = j.token; return this.token; }
    } catch (e) { /* 离线/跨域失败时静默降级 */ }
    return null;
  },

  /** 取某个课程实验的全班汇总（带缓存） */
  async summary(expId) {
    if (this.cache[expId]) return this.cache[expId];
    const cached = sessionStorage.getItem("alab_class_" + expId);
    if (cached) {
      try { const d = JSON.parse(cached); this.cache[expId] = d; return d; } catch (_) { }
    }
    await this.login();
    try {
      const r = await fetch(`${this.LAB}/api/class/summary?exp=${expId}&input=keyboard`);
      const j = await r.json();
      if (j && j.data) {
        this.cache[expId] = j.data;
        try { sessionStorage.setItem("alab_class_" + expId, JSON.stringify(j.data)); } catch (_) { }
        return j.data;
      }
    } catch (e) { /* 网络失败静默 */ }
    return null;
  },
};
