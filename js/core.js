/* ============================================================
   core.js —— 共享核心：会话管理 / 收数 / WebGazer / 进度条
   依赖：config.js、vendor/webgazer.js
   ============================================================ */
"use strict";

/* ---------- 运行时项目码覆盖：链接 ?project=XXXXXX 优先于 config.js ----------
   发被试链接时可直接带项目码（如 experiments/ib.html?project=ABC234），
   无需改动代码即可切换/启用上传；未带参数时用 config.js 中的 PROJECT_CODE。
   ?test=1：experiment 名自动加 test_ 前缀（调试数据与正式数据分离，
   正式收数前在 /hw2「我的项目」里删除测试被试）。 */
window.__ALAB_TEST__ = new URLSearchParams(location.search).get("test") === "1";
(function () {
  const p = new URLSearchParams(location.search).get("project");
  if (p && /^[A-Za-z0-9]{4,10}$/.test(p)) CONFIG.PROJECT_CODE = p.toUpperCase();
})();

/* ---------- 小工具 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);

/** 带种子的伪随机数（mulberry32），保证组间平衡可复现 */
function RNG(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5; let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** 下载文本文件 */
function downloadText(name, text, mime = "text/plain") {
  const b = new Blob(["\uFEFF" + text], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function toCSV(rows) {
  return rows.map(r => r.map(c => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(",")).join("\n");
}

/* ---------- 进度条 ---------- */
const Progress = {
  show() { $("#progress-shell") && ($("#progress-shell").style.display = "block"); },
  hide() { $("#progress-shell") && ($("#progress-shell").style.display = "none"); },
  set(frac, label) {
    const bar = $("#progress-bar"), lb = $("#progress-label");
    if (bar) bar.style.width = clamp(frac * 100, 0, 100) + "%";
    if (lb) lb.textContent = label || "";
  },
};

/* ---------- 会话（被试编号、知情同意、实验数据暂存） ---------- */
const Session = {
  pid: null, useEye: false, ts: null,
  /** 生成/读取匿名被试编号，如 P017 */
  init(prefix = "P") {
    let n = +(localStorage.getItem("alab_pid_n") || 0) + 1;
    localStorage.setItem("alab_pid_n", n);
    this.pid = prompt("请输入被试匿名编号（直接回车则自动生成）：", "") || (prefix + String(n).padStart(3, "0"));
    this.ts = new Date().toISOString();
    return this.pid;
  },
};

/* ---------- 数据收集与上传 ---------- */
const Collector = {
  trials: [], gazeSummary: [], experiment: "unknown", condition: "",
  begin(experiment, condition) {
    // ?test=1 时加 test_ 前缀：调试数据与正式数据分离（正式收数前在 /hw2 删除测试被试）
    this.experiment = (window.__ALAB_TEST__ ? "test_" : "") + experiment;
    this.condition = condition;
    this.trials = []; this.gazeSummary = []; this.t0 = performance.now();
  },
  push(trial) { trial.pid = Session.pid; this.trials.push(trial); },
  pushGaze(g) { this.gazeSummary.push(g); },
  /** 导出 CSV（收数接口不可用时的兜底） */
  exportCSV(extraCols = {}) {
    if (!this.trials.length) return;
    const keys = [...new Set(this.trials.flatMap(t => Object.keys(t)))];
    const rows = [keys, ...this.trials.map(t => keys.map(k => t[k] ?? ""))];
    downloadText(`${this.experiment}_${Session.pid}.csv`, toCSV(rows), "text/csv");
  },
  /** POST 到注意实验室收数接口；返回 Promise<{ok, ...}>。
   *  接口行为（2026-11-06 实测）：成功 → {ok:true, record_id, warnings?}；
   *  项目码错误 → HTTP 404 + {ok:false, msg:"项目码不存在…"}；CORS 全开（file:// 也可上传） */
  async submit(extra = {}) {
    const payload = {
      project: CONFIG.PROJECT_CODE,
      experiment: this.experiment,
      participant: Session.pid,
      condition: this.condition,
      calib: this.calib,                        // 眼动校准质量（未开眼动时为 null；嵌套对象由后台转 JSON 存档）
      started_at: Session.ts || null,           // 会话开始 ISO 时间戳
      n_trials: this.trials.length,
      duration_ms: Math.round(performance.now() - this.t0),
      meta: {                                   // 课程模板规范的环境信息
        ua: String(navigator.userAgent || "").slice(0, 80),
        w: innerWidth || null,
        h: innerHeight || null,
      },
      trials: this.trials,
      ...extra,
    };
    // 无论上传成败，先落本地
    const localKey = "alab_data_" + this.experiment + "_" + Session.pid;
    localStorage.setItem(localKey, JSON.stringify(payload));
    if (!CONFIG.PROJECT_CODE || CONFIG.PROJECT_CODE === "XXXXXX") {
      return { ok: false, reason: "未配置项目码（config.js 或链接 ?project=）——数据已存本地，可导出 CSV" };
    }
    try {
      const r = await fetch(CONFIG.API_SUBMIT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let body = null;
      try { body = await r.json(); } catch (_) { }
      if (r.ok && body && body.ok !== false) {
        return { ok: true, recordId: body.record_id || null, warnings: body.warnings || null };
      }
      return { ok: false, reason: (body && body.msg) ? ("服务器：" + body.msg) : ("HTTP " + r.status) };
    } catch (e) { return { ok: false, reason: "网络错误：" + e.message }; }
  },
  /** 生成收数总结（供结束页展示） */
  summary() {
    return { n: this.trials.length, experiment: this.experiment, pid: Session.pid };
  },
  /** 校准质量随 payload 上传（calibFlow 结果：{ok, errPx, rounds}） */
  calib: null,
};

/* ---------- WebGazer 眼动管理（自托管，本地处理，不上传视频） ---------- */
const WG = {
  ready: false, enabled: false, buffer: [], listener: null, lastT: 0, previewStream: null,
  /** 初始化摄像头眼动。返回是否成功。 */
  async init() {
    if (typeof webgazer === "undefined") { alert("webgazer.js 未加载"); return false; }
    // file:// 协议下浏览器禁用摄像头，必须经本地服务器（https://localhost）访问
    if (!window.isSecureContext || location.protocol === "file:") {
      alert("当前页面是直接双击 HTML 文件打开的（file:// 协议），浏览器会禁用摄像头。\n" +
        "请关闭本页，运行项目根目录下的「启动实验.bat」，通过本地服务器打开后再开启眼动。");
      this.hidePreview();
      return false;
    }
    try {
      // 显式申请摄像头权限：成功后把视频流接入右下角预览小窗
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        this.previewStream = stream;
        const pv = $("#wg-video");
        if (pv) { pv.srcObject = stream; pv.play().catch(() => { }); }
      } catch (e) {
        alert("摄像头不可用：" + (e.name === "NotAllowedError"
          ? "权限被拒绝。请点击浏览器地址栏右侧的摄像头图标，允许访问后刷新页面重试。"
          : (e.message || e.name)));
        this.hidePreview();
        return false;
      }
      // webgazer 2.0.1 链式 API（该版本没有 setVideoViewerEnabled，误用会抛 TypeError）
      webgazer
        .showVideo(false)
        .showFaceOverlay(false)
        .showFaceFeedbackBox(false)
        .applyKalmanFilter(true);
      this.listener = webgazer.setGazeListener((data, t) => {
        if (data) {
          const now = performance.now();
          if (now - this.lastT > 33) {               // ~30Hz 采样
            this.buffer.push({ x: data.x, y: data.y, t: now });
            if (this.buffer.length > 12000) this.buffer.splice(0, 4000); // 防爆内存
            this.lastT = now;
          }
        }
      }).begin();
      this.ready = true; this.enabled = true;
      return true;
    } catch (e) { console.warn("WebGazer 初始化失败", e); return false; }
  },
  /** 九点校准：返回 Promise<boolean>（每点注视并单击 3 次） */
  calibrate() {
    return new Promise(resolve => {
      const N = 3;                       // 每点点击次数
      const pts = [[.08,.12],[.5,.08],[.92,.12],[.08,.5],[.5,.5],[.92,.5],[.08,.88],[.5,.92],[.92,.88]];
      const dot = $("#calib-dot"); const ov = $("#wg-overlay");
      const ctx = ov.getContext("2d"); ov.width = innerWidth; ov.height = innerHeight;
      let i = 0, clicks = 0;
      const done = () => {
        dot.onclick = null;                 // 训练结束：验证阶段的点击不再进入训练数据
        dot.classList.remove("on"); ov.style.display = "none"; ctx.clearRect(0,0,ov.width,ov.height);
        resolve(true);
      };
      const show = () => {
        if (i >= pts.length) return done();
        const [x, y] = pts[i];
        dot.style.left = (x * innerWidth) + "px"; dot.style.top = (y * innerHeight) + "px";
        dot.classList.add("on");
        dot.textContent = (clicks < N ? (N - clicks) : "");
        clicks = 0;
      };
      dot.onclick = () => {
        if (clicks === 0 && webgazer.recordScreenPosition)
          webgazer.recordScreenPosition(parseFloat(dot.style.left), parseFloat(dot.style.top), "click");
        clicks++;
        if (clicks >= N) { i++; setTimeout(show, 350); }
        else dot.textContent = (N - clicks);
      };
      ov.style.display = "none"; show();
    });
  },
  /** 标记事件窗口：抓取 [t0,t1] 时间段内的注视样本（performance.now 时间基） */
  window(t0, t1) {
    return this.buffer.filter(g => g.t >= t0 && g.t <= t1).map(g => ({ x: g.x, y: g.y }));
  },
  /** 落点是否落在某屏内矩形附近（像素坐标） */
  contactRate(samples, rect, margin = 120) {
    if (!samples || !samples.length) return null;
    const hit = samples.filter(s => s.x > rect.x - margin && s.x < rect.x + rect.w + margin &&
                                    s.y > rect.y - margin && s.y < rect.y + rect.h + margin);
    return hit.length / samples.length;
  },
  stop() {
    try { webgazer.end(); } catch (e) { }
    this.enabled = false;
    if (this.previewStream) {
      this.previewStream.getTracks().forEach(t => t.stop());
      this.previewStream = null;
    }
    const v = $("#wg-video"); if (v) v.remove();
  },

  /* ---------- 校准质量验证（参考课程注意实验室的精度口径：网页眼动 ≈ 4° ≈ 150–250 px） ---------- */
  /** 五点注视验证：中心 + 四角，每点倒计时引导注视后采样 1s，
   *  取注视中位数与真实点位求距离。返回 [{x, y, err}]（err=null 表示该点样本不足） */
  verify() {
    return new Promise(resolve => {
      const pts = [[.5, .5], [.10, .16], [.90, .16], [.10, .84], [.90, .84]];
      const dot = $("#calib-dot");
      const res = [];
      const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
      let i = 0;
      const show = () => {
        if (i >= pts.length) { dot.classList.remove("on"); return resolve(res); }
        const X = pts[i][0] * innerWidth, Y = pts[i][1] * innerHeight;
        dot.style.left = X + "px"; dot.style.top = Y + "px";
        dot.classList.add("on");
        const t0 = performance.now();
        let c = 3;
        dot.textContent = c;
        const tick = setInterval(() => { c--; if (c > 0) dot.textContent = c; }, 350);
        setTimeout(() => {                                   // 倒计时结束，开始采样
          clearInterval(tick); dot.textContent = "";
          const s0 = this.buffer.length;
          setTimeout(() => {
            const samples = this.buffer.slice(s0).filter(s => s.t >= t0 + 1050);
            if (samples.length >= 5) {
              const mx = med(samples.map(s => s.x)), my = med(samples.map(s => s.y));
              res.push({ x: X, y: Y, err: Math.hypot(mx - X, my - Y) });
            } else res.push({ x: X, y: Y, err: null });      // 样本不足（人脸丢失等）
            i++; dot.classList.remove("on");
            setTimeout(show, 300);
          }, 1000);
        }, 1050);
      };
      show();
    });
  },

  /** 完整校准流程：9 点点击训练 → 5 点验证 → 结果报告（被试可见）→
   *  通过则继续 / 不达标由被试自选「重新校准」或「仅采行为数据」。
   *  返回 {ok:boolean, errPx:number|null, rounds:number} */
  async calibFlow() {
    let rounds = 0;
    while (true) {
      rounds++;
      await this.calibrate();
      const v = await this.verify();
      const errs = v.map(p => p.err).filter(e => e != null);
      let errPx = null, grade;
      if (!errs.length) { grade = "noGaze"; }
      else {
        errPx = mean(errs);
        grade = errPx <= 150 ? "good" : errPx <= 250 ? "ok" : "bad";
      }
      const choice = await calibChoiceModal(errPx, grade, rounds);
      if (choice === "continue") return { ok: true, errPx: errPx == null ? null : Math.round(errPx), rounds };
      if (choice === "skip") { this.stop(); return { ok: false, errPx: errPx == null ? null : Math.round(errPx), rounds }; }
      // redo → 再来一轮（由被试主动选择，不限次数）
    }
  },
  /** 摄像头不可用时隐藏预览小窗（避免留下黑框） */
  hidePreview() {
    const v = $("#wg-video"); if (v) v.remove();
  },
};

/* ---------- 校准结果面板：被试可见的精度报告 + 自主选择 ---------- */
/** 返回 "continue"（继续实验）| "redo"（重新校准）| "skip"（仅行为数据） */
function calibChoiceModal(errPx, grade, rounds) {
  const px = errPx == null ? "" : `估计误差约 <b>${Math.round(errPx)} px</b>（页面尺寸均值）`;
  const CFG = {
    good: { title: "校准良好", cls: "ok",
      tip: `${px}，优于网页眼动的典型精度（150–250 px ≈ 4°）。可以开始实验，建议全程保持头部稳定。`,
      buttons: [["继续实验", "", "continue"], ["重新校准", "ghost", "redo"], ["仅采集行为数据", "gray", "skip"]] },
    ok: { title: "校准可用", cls: "info",
      tip: `${px}，处于网页眼动的典型精度范围内（150–250 px ≈ 4°）。可以开始实验，请尽量保持头部稳定、避免频繁眨眼。`,
      buttons: [["继续实验", "", "continue"], ["重新校准", "ghost", "redo"], ["仅采集行为数据", "gray", "skip"]] },
    bad: { title: "校准精度不足", cls: "err",
      tip: `${px}，明显大于网页眼动的典型精度（150–250 px ≈ 4°）。常见原因：头部移动、光线不足、点击时未真正注视目标。<br>建议<b>重新校准</b>（调整坐姿、正对摄像头），或改用<b>仅行为数据</b>模式（不影响主实验流程）。`,
      buttons: [["重新校准（推荐）", "", "redo"], ["仅采集行为数据", "ghost", "skip"], ["仍要继续", "gray", "continue"]] },
    noGaze: { title: "未能估计注视精度", cls: "warn",
      tip: "验证阶段没有收集到足够的注视样本（可能人脸丢失或摄像头异常）。可以重新校准，或改用仅行为数据模式。",
      buttons: [["重新校准（推荐）", "", "redo"], ["仅采集行为数据", "ghost", "skip"], ["仍要继续", "gray", "continue"]] },
  }[grade] || {};
  return new Promise(resolve => {
    const div = document.createElement("div");
    div.id = "calib-modal";
    div.style.cssText = "position:fixed;inset:0;z-index:150;background:rgba(24,24,27,.82);display:flex;align-items:center;justify-content:center";
    div.innerHTML = `
      <div class="card fade" style="max-width:500px;width:92%">
        <h2 style="margin-bottom:8px"><span class="badge ${CFG.cls}">${CFG.title}</span>
          ${rounds > 1 ? `<span class="muted" style="font-size:13px">（第 ${rounds} 轮校准）</span>` : ""}</h2>
        <p style="line-height:1.7">${CFG.tip}</p>
        <div class="btn-row" style="flex-wrap:wrap;gap:10px">
          ${CFG.buttons.map(([label, cls, val]) => `<button class="btn ${cls}" data-v="${val}">${label}</button>`).join("")}
        </div>
      </div>`;
    div.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { div.remove(); resolve(b.dataset.v); }));
    document.body.appendChild(div);
  });
}

/* ---------- 眼动开关 + 摄像头小窗 ---------- */
function ensureWGOverlay() {
  if ($("#wg-video")) return;
  const v = document.createElement("video"); v.id = "wg-video"; v.muted = true; v.playsInline = true;
  document.body.appendChild(v);
  const ov = document.createElement("canvas"); ov.id = "wg-overlay";
  ov.width = innerWidth; ov.height = innerHeight; ov.style.display = "none";
  document.body.appendChild(ov);
  const dot = document.createElement("div"); dot.id = "calib-dot"; dot.className = "calib-dot";
  document.body.appendChild(dot);
}

/* ---------- 通用实验流程装饰：知情同意 + 眼动询问 ---------- */
function buildConsentFlow(expName, extraConsentHTML = "") {
  return `
  <div class="card fade">
    <h1>${expName}</h1>
    <p class="muted">注意实验室 · 在线认知实验</p>
    <div class="callout"><b>知情同意</b><br>
      本实验完全匿名，不收集姓名、学号等任何身份信息，数据仅用于注意与知觉研究分析。
      ${extraConsentHTML}
    </div>
    <div class="field">
      <label>请确认：</label>
      <div class="radio-row">
        <label><input type="checkbox" id="consent-ok"> 我已阅读并同意参加</label>
      </div>
    </div>
    <div class="field">
      <label>摄像头眼动（可选）</label>
      <div class="radio-row">
        <label><input type="radio" name="eye" value="1" checked> 开启摄像头眼动（视频在浏览器本地处理，<b>不会</b>上传或保存）</label>
        <label><input type="radio" name="eye" value="0"> 不开启，仅行为数据</label>
      </div>
      <p class="muted">如摄像头不可用，实验将自动跳过眼动。</p>
    </div>
    <div class="btn-row">
      <button class="btn" id="btn-go" disabled>进入实验</button>
    </div>
  </div>`;
}
function bindConsentFlow(onStart) {
  const ok = $("#consent-ok"), btn = $("#btn-go");
  ok.addEventListener("change", () => { btn.disabled = !ok.checked; });
  btn.addEventListener("click", async () => {
    Session.init();
    const useEye = document.querySelector('input[name=eye]:checked').value === "1";
    if (useEye) {
      ensureWGOverlay();                       // 仅在开启眼动时才创建预览小窗等元素
      btn.disabled = true; btn.textContent = "正在启动摄像头…";
      const started = await WG.init();
      if (started) {
        btn.textContent = "眼动校准：依次注视并单击出现的白色圆点";
        // 9 点点击训练 → 5 点注视验证 → 误差报告（被试可见）→ 通过/重校/仅行为 由被试自选
        const cal = await WG.calibFlow();
        Collector.calib = cal;                 // 校准质量（误差 px、轮数、是否启用）随数据上传
        if (!cal.ok) alert("已切换为仅行为数据模式，实验不受影响。");
      } else {
        alert("已切换为仅行为数据模式，实验不受影响。");
      }
    }
    onStart();
  });
}

/* ---------- 装饰 SVG（简约几何线条，静态无动画；永不进入刺激画布） ---------- */
const DECO_SVG = {
  tl: `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" stroke="#4f46e5" stroke-width="1"><circle cx="30" cy="30" r="20"/><circle cx="30" cy="30" r="10"/><line x1="10" y1="80" x2="80" y2="80"/><line x1="25" y1="70" x2="25" y2="90"/><line x1="45" y1="70" x2="45" y2="90"/><line x1="65" y1="70" x2="65" y2="90"/></svg>`,
  br: `<svg width="100" height="100" viewBox="0 0 100 100" fill="none" stroke="#4f46e5" stroke-width="1"><rect x="20" y="20" width="40" height="40" rx="8"/><circle cx="70" cy="70" r="15"/><line x1="40" y1="60" x2="40" y2="85"/><line x1="55" y1="75" x2="25" y2="75"/></svg>`,
};
