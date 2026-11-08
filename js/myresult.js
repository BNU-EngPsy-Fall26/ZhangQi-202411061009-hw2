/* ============================================================
   myresult.js —— 被试个人结果页（我的结果 + 全班基线对比）
   ------------------------------------------------------------
   数据来源（两路）：
   ① 我的结果：本次实验的 Collector.trials
   ② 全班基线：课程注意实验室「我的结果」页所用的 /api/class/summary
      —— 对应课程三个原始实验（专注计数 / 速测 flanker / 估一估 cm），
         登录后读取，代表全班同学在该范式上的平均水平
   对比方式：我的条件均值 vs 全班对应条件的均值，分组柱状图 + 一句话解读
   ============================================================ */
"use strict";

/* 课程实验代号映射（与课程站 EXPS 注册表一致） */
const CLASS_EXP = {
  ib: "inattention",      // W5 · 专注任务（默数目标次数）
  flanker: "flanker",     // W6 · 冲突（相邻位置 flanker 速测）
  cm: "cm",               // W7 · 图形比例估计（估一估）
};

/* ---------- 迷你柱状图（双系列：我 / 全班） ---------- */
function miniChart(canvas, cfg) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const H = parseInt(canvas.style.height) || 200;
  const W = canvas.clientWidth || 340;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const L = 46, R = 12, T = 34, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const ymin = cfg.ymin == null ? 0 : cfg.ymin;
  const ymax = cfg.ymax || 1;
  const y2p = v => T + ph - (v - ymin) / (ymax - ymin) * ph;
  const mono = '10px "JetBrains Mono", ui-monospace, monospace';

  // 网格 + y 轴刻度
  for (let i = 0; i <= 4; i++) {
    const v = ymin + (ymax - ymin) * i / 4, y = y2p(v);
    ctx.strokeStyle = "rgba(122,167,190,.16)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillStyle = "#8a9db0"; ctx.font = mono; ctx.textAlign = "right";
    ctx.fillText(+v.toFixed(cfg.yfmt === 1 ? 0 : 2), L - 6, y + 3.5);
  }

  // 柱体
  const n = cfg.labels.length, bw = pw / n;
  cfg.series.forEach((s, si) => {
    const w = Math.min(24, (bw - 12) / cfg.series.length);
    s.values.forEach((v, i) => {
      if (v == null || isNaN(v)) return;
      const x = L + bw * i + bw / 2 - (cfg.series.length * w) / 2 + si * w + w / 2;
      const yTop = Math.min(y2p(v), T + ph);
      ctx.fillStyle = s.color;
      ctx.fillRect(x - w / 2, yTop, w, T + ph - yTop);
      ctx.fillStyle = "#c9d6e0"; ctx.font = mono; ctx.textAlign = "center";
      ctx.fillText(+v.toFixed(cfg.yfmt === 1 ? 0 : 2), x, Math.max(yTop - 4, T + 9));
    });
  });

  // x 轴标签（自适应截断）
  ctx.fillStyle = "#9fb2c2"; ctx.font = mono; ctx.textAlign = "center";
  cfg.labels.forEach((t, i) => {
    const maxW = Math.max(30, bw - 8);
    let lab = String(t);
    while (ctx.measureText(lab).width > maxW && lab.length > 2) lab = lab.slice(0, -1);
    if (lab !== String(t)) lab += "…";
    ctx.fillText(lab, L + bw * i + bw / 2, H - 16);
  });

  // 图例
  let lx = L;
  cfg.series.forEach(s => {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 12, 9, 9);
    ctx.fillStyle = "#9fb2c2"; ctx.font = mono; ctx.textAlign = "left";
    ctx.fillText(s.name, lx + 13, 20);
    lx += 16 + ctx.measureText(s.name).width + 18;
  });
}

/* ---------- 三个实验的对比构建器（全部对接课程真实字段） ---------- */

/** 实验1 非注意盲：我的速度条件察觉率 vs 全班整体察觉率基线 */
function buildIBCompare(trials, cls) {
  const rate = a => a.length ? a.filter(t => t.noticed === 1).length / a.length : null;
  const myRates = [
    rate(trials.filter(t => t.speed === "fast")),
    rate(trials.filter(t => t.speed === "slow")),
    rate(trials.filter(t => t.speed === "static")),
  ];
  // 全班基线：课程「专注计数」实验的整体察觉率（十字计数范式）
  let clsRate = null, clsN = null;
  if (cls && cls.paradigms && cls.paradigms.shapes) {
    const sh = cls.paradigms.shapes;
    const m = sh.marginals && sh.marginals.cross;
    if (m) {
      const b = m.black && m.black.rate, w = m.white && m.white.rate;
      const vals = [b, w].filter(v => v != null);
      if (vals.length) clsRate = vals.reduce((a, b2) => a + b2, 0) / vals.length;
      clsN = sh.n;
    }
  }
  return {
    labels: ["快速", "慢速", "静止"],
    mySeries: myRates,
    clsSeries: [clsRate, clsRate, clsRate],   // 基线是整体察觉率，各条件画同一参考线
    ymax: 1, yfmt: 2,
    title: "察觉率：我的三种速度条件 vs 全班基线",
    note: clsRate != null
      ? `全班基线（课程「专注计数」原始实验，n = ${clsN || "?"}）整体察觉率 ${(clsRate * 100).toFixed(0)}%。`
        + `该实验用十字计数范式，与我的传球计数范式不同，仅作量级参照；重点看我的三条柱之间的差异。`
      : "未能读取全班基线数据。",
  };
}

/** 实验2 Flanker：我的四条件冲突量 vs 全班三条件干扰量 */
function buildFLKCompare(trials, cls) {
  const rt = (emo, cong) => {
    const a = trials.filter(t => t.flankerEmo === emo && t.congruent === cong && t.correct === 1);
    return a.length ? a.reduce((s, x) => s + x.rt, 0) / a.length : null;
  };
  const nC = rt("neutral", 1), nI = rt("neutral", 0), aC = rt("angry", 1), aI = rt("angry", 0);
  const myCostN = (nC != null && nI != null) ? nI - nC : null;
  const myCostA = (aC != null && aI != null) ? aI - aC : null;

  // 全班：课程 flanker 的 interference = incongruent − congruent
  let clsInt = null, clsN = null;
  if (cls && cls.conds) {
    const c = cls.conds;
    if (c.incongruent && c.congruent && c.incongruent.mean_rt != null && c.congruent.mean_rt != null) {
      clsInt = c.incongruent.mean_rt - c.congruent.mean_rt;
    }
    clsN = cls.n;
  }
  return {
    labels: ["我·中性侧翼", "我·愤怒侧翼", "全班·经典"],
    mySeries: [myCostN, myCostA, null],
    clsSeries: [null, null, clsInt],
    ymax: Math.max(Math.abs(myCostN || 0), Math.abs(myCostA || 0), Math.abs(clsInt || 0), 40) * 1.35,
    yfmt: 1,
    title: "冲突量（不一致 − 一致，ms）：我 vs 全班",
    note: clsInt != null
      ? `全班基线（课程 flanker 速测，n = ${clsN || "?"}）干扰量 ${clsInt.toFixed(1)} ms`
        + `（落在 Eriksen 与 Eriksen 1974 报告的 20–60 ms 区间）。`
        + `我的两柱分别对应中性侧翼与愤怒侧翼，可与基线直接比较。`
      : "未能读取全班基线数据。",
  };
}

/** 实验3 C&M：我的四编码误差 vs 全班四编码误差 */
function buildCMCompare(trials, cls) {
  const encs = ["position", "length", "angle", "area"];
  const cn = { position: "位置", length: "长度", angle: "角度", area: "面积" };
  const myErr = encs.map(e => {
    const a = trials.filter(t => t.enc === e && t.absErr != null);
    return a.length ? a.reduce((s, x) => s + x.absErr, 0) / a.length : null;
  });
  let clsErr = [null, null, null, null], clsN = null;
  if (cls && cls.encs) {
    clsErr = encs.map(e => (cls.encs[e] && cls.encs[e].mean_err != null) ? cls.encs[e].mean_err : null);
    clsN = cls.n;
  }
  const all = [...myErr, ...clsErr].filter(v => v != null);
  return {
    labels: encs.map(e => cn[e]),
    mySeries: myErr,
    clsSeries: clsErr,
    ymax: Math.max(...all, 4) * 1.3, yfmt: 1,
    title: "估计绝对误差（%）：我的四编码 vs 全班",
    note: (clsN != null)
      ? `全班基线（课程「估一估」原始实验，n = ${clsN}）四编码平均绝对误差。`
        + `口径一致（百分比绝对误差），可直接逐编码比较我的误差位置。`
      : "未能读取全班基线数据。",
  };
}

/* ---------- 主入口 ---------- */
async function renderMyResult(expKey, trials, hostEl) {
  const host = hostEl || document.getElementById("my-result");
  if (!host) return;

  host.innerHTML = `
    <div class="myresult">
      <div class="myresult-head">
        <h2 style="margin:0">你的结果</h2>
        <span class="badge info" id="mr-src"></span>
      </div>
      <div id="mr-kpi" class="kpi-row"></div>
      <div class="chart-box" style="margin:14px 0 0">
        <h3 id="mr-title">与全班对比</h3>
        <canvas id="mr-chart" style="height:210px"></canvas>
        <p class="muted" id="mr-note"></p>
      </div>
      <p class="muted" id="mr-loading" style="margin-top:10px">正在读取全班数据…</p>
    </div>`;

  // 数据来源徽章
  const srcEl = document.getElementById("mr-src");
  if (srcEl) {
    const s = (typeof GZ !== "undefined") ? GZ.source : "none";
    srcEl.textContent = s === "eye" ? "眼动数据" : s === "mouse" ? "鼠标追踪数据" : "行为数据";
  }

  // 个人 KPI
  const kpi = document.getElementById("mr-kpi");
  if (expKey === "ib") {
    const n = trials.filter(t => t.noticed === 1).length;
    const errs = trials.map(t => t.countErr).filter(v => v != null);
    kpi.innerHTML = `
      <div class="kpi"><div class="v">${n}/${trials.length}</div><div class="k">察觉到的轮次</div></div>
      <div class="kpi"><div class="v">${trials.length ? (n / trials.length * 100).toFixed(0) : 0}%</div><div class="k">察觉率</div></div>
      <div class="kpi"><div class="v">${errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) : "—"}</div><div class="k">平均计数误差</div></div>`;
  } else if (expKey === "flanker") {
    const ok = trials.filter(t => t.correct === 1);
    const acc = trials.length ? trials.filter(t => t.correct === 1).length / trials.length : 0;
    const mrt = ok.length ? ok.reduce((s, x) => s + x.rt, 0) / ok.length : null;
    kpi.innerHTML = `
      <div class="kpi"><div class="v">${(acc * 100).toFixed(0)}%</div><div class="k">正确率</div></div>
      <div class="kpi"><div class="v">${mrt ? Math.round(mrt) : "—"}</div><div class="k">平均反应时 (ms)</div></div>
      <div class="kpi"><div class="v">${trials.length}</div><div class="k">有效试次</div></div>`;
  } else {
    const errs = trials.map(t => t.absErr).filter(v => v != null);
    const l2 = trials.map(t => t.log2err).filter(v => v != null);
    kpi.innerHTML = `
      <div class="kpi"><div class="v">${errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) + "%" : "—"}</div><div class="k">平均绝对误差</div></div>
      <div class="kpi"><div class="v">${l2.length ? (l2.reduce((a, b) => a + b, 0) / l2.length).toFixed(2) : "—"}</div><div class="k">平均 log₂ 误差</div></div>
      <div class="kpi"><div class="v">${trials.length}</div><div class="k">有效试次</div></div>`;
  }

  // 读全班基线（课程「我的结果」页同源接口）
  let cls = null;
  try { cls = await CLASSDATA.summary(CLASS_EXP[expKey]); } catch (_) { }

  const cmp = expKey === "ib" ? buildIBCompare(trials, cls)
    : expKey === "flanker" ? buildFLKCompare(trials, cls)
      : buildCMCompare(trials, cls);

  const load = document.getElementById("mr-loading");
  if (load) load.remove();

  const title = document.getElementById("mr-title");
  if (title) title.textContent = cmp.title;
  const note = document.getElementById("mr-note");
  if (note) {
    note.innerHTML = cls
      ? (cmp.note || "")
      : "未能读取全班基线数据（可能离线或接口暂不可用）。你的个人结果已完整记录并上传。";
  }

  miniChart(document.getElementById("mr-chart"), {
    labels: cmp.labels,
    ymax: cmp.ymax, yfmt: cmp.yfmt,
    series: [
      { name: "我", color: "#26ffa4", values: cmp.mySeries },
      { name: "全班", color: "#3ee1ff", values: cmp.clsSeries },
    ],
  });
}
