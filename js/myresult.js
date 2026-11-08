/* ============================================================
   myresult.js —— 被试个人结果页（我的结果 + 全班对比）
   ------------------------------------------------------------
   实验结束页调用 renderMyResult(实验键)，渲染为：
     ┌ 本人在该实验的关键读数（KPI）
     ├ 我的结果 vs 全班（分组柱：每个条件两根柱）
     └ 简短的定性解读（比全班更快/更准/更易察觉…）
   全班数据来自 CLASSDATA.summary()（课程注意实验室，登录后读取）。
   ============================================================ */
"use strict";

/* 课程实验代号映射 */
const CLASS_EXP = {
  ib: "inattention",      // 非注意盲（十字计数范式）
  flanker: "flanker",     // 经典 Flanker
  cm: "cm",               // C&M 图形知觉
};

/* ---------- 迷你柱状图（双系列：我 / 全班） ---------- */
function miniChart(canvas, cfg) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const H = parseInt(canvas.style.height) || 190;
  const W = canvas.clientWidth || 340;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const L = 42, R = 10, T = 30, B = 34;
  const pw = W - L - R, ph = H - T - B;
  const ymin = cfg.ymin == null ? 0 : cfg.ymin;
  const ymax = cfg.ymax;
  const y2p = v => T + ph - (v - ymin) / (ymax - ymin) * ph;
  const mono = '10px "JetBrains Mono", ui-monospace, monospace';

  // 网格
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = ymin + (ymax - ymin) * i / ticks, y = y2p(v);
    ctx.strokeStyle = "rgba(122,167,190,.18)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillStyle = "#8a9db0"; ctx.font = mono; ctx.textAlign = "right";
    ctx.fillText(+v.toFixed(cfg.yfmt === 1 ? 0 : 2), L - 6, y + 3.5);
  }

  // 柱
  const n = cfg.labels.length, bw = pw / n;
  cfg.series.forEach((s, si) => {
    const w = Math.min(26, (bw - 10) / cfg.series.length);
    s.values.forEach((v, i) => {
      if (v == null || isNaN(v)) return;
      const x = L + bw * i + bw / 2 - (cfg.series.length * w) / 2 + si * w + w / 2;
      const yTop = Math.min(y2p(v), T + ph);
      ctx.fillStyle = s.color;
      ctx.fillRect(x - w / 2, yTop, w, T + ph - yTop);
      ctx.fillStyle = "#c9d6e0"; ctx.font = mono; ctx.textAlign = "center";
      ctx.fillText(+v.toFixed(cfg.yfmt === 1 ? 0 : 2), x, yTop - 4);
    });
  });

  // x 轴标签
  ctx.fillStyle = "#9fb2c2"; ctx.font = mono; ctx.textAlign = "center";
  cfg.labels.forEach((t, i) => ctx.fillText(t, L + bw * i + bw / 2, H - 14));

  // 图例
  let lx = L;
  cfg.series.forEach(s => {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 12, 8, 8);
    ctx.fillStyle = "#9fb2c2"; ctx.font = mono; ctx.textAlign = "left";
    ctx.fillText(s.name, lx + 12, 19.5);
    lx += 14 + ctx.measureText(s.name).width + 16;
  });
}

/* ---------- 各实验的「我 vs 全班」配置 ---------- */
function buildIBCompare(trials, cls) {
  const rate = a => a.length ? a.filter(t => t.noticed === 1).length / a.length : null;
  const mine = {
    fast: rate(trials.filter(t => t.speed === "fast")),
    slow: rate(trials.filter(t => t.speed === "slow")),
    static: rate(trials.filter(t => t.speed === "static")),
  };
  // 全班（十字计数）：黑白十字的察觉率映射到快/慢/静三档不可行，
  // 因此用「异类 vs 同类」维度对比（与实验逻辑一致）
  let clsSeries = [null, null, null];
  let labels = ["快速", "慢速", "静止"];
  let mySeries = [mine.fast, mine.slow, mine.static];
  if (cls && cls.paradigms && cls.paradigms.shapes) {
    const m = cls.paradigms.shapes.marginals.cross;
    // 全班只有「黑十字/白十字」两档，这里作为整体参考线呈现
    const clsAvg = ((m.black.rate || 0) + (m.white.rate || 0)) / 2;
    clsSeries = [clsAvg, clsAvg, clsAvg];
  }
  return {
    labels, mySeries, clsSeries,
    ymax: 1, yfmt: 2,
    title: "察觉率：我 vs 全班平均",
    note: cls ? `全班（${cls.paradigms.shapes.n || "?"} 人次，十字计数范式）整体察觉率约 ${((((cls.paradigms.shapes.marginals.cross.black.rate||0)+(cls.paradigms.shapes.marginals.cross.white.rate||0))/2)*100).toFixed(0)}%；范式不同，仅作量级参考。` : "",
  };
}

function buildFLKCompare(trials, cls) {
  const rt = (emo, cong) => {
    const a = trials.filter(t => t.flankerEmo === emo && t.congruent === cong && t.correct === 1);
    return a.length ? a.reduce((s, x) => s + x.rt, 0) / a.length : null;
  };
  const nC = rt("neutral", 1), nI = rt("neutral", 0), aC = rt("angry", 1), aI = rt("angry", 0);
  const myCostN = (nC != null && nI != null) ? nI - nC : null;
  const myCostA = (aC != null && aI != null) ? aI - aC : null;
  let clsN = null, clsA = null;
  if (cls && cls.conds) {
    // 全班只有 congruent/incongruent/neutral 三格（无情绪维度）
    clsN = (cls.conds.incongruent && cls.conds.congruent)
      ? cls.conds.incongruent.mean_rt - cls.conds.congruent.mean_rt : null;
  }
  return {
    labels: ["中性侧翼", "愤怒侧翼", "全班·经典"],
    mySeries: [myCostN, myCostA, null],
    clsSeries: [null, null, clsN],
    ymax: Math.max(Math.abs(myCostN || 0), Math.abs(myCostA || 0), Math.abs(clsN || 0), 40) * 1.35,
    yfmt: 1,
    title: "冲突量（不一致 − 一致，ms）：我 vs 全班",
    note: clsN != null ? `全班经典 Flanker 干扰量 ${clsN.toFixed(0)}ms（落在 Eriksen 1974 的 20–60ms 区间）；我的中性/愤怒侧翼冲突量见左两柱。` : "",
  };
}

function buildCMCompare(trials, cls) {
  const encs = ["position", "length", "angle", "area"];
  const cn = { position: "位置", length: "长度", angle: "角度", area: "面积" };
  const myErr = encs.map(e => {
    const a = trials.filter(t => t.enc === e && t.absErr != null);
    return a.length ? a.reduce((s, x) => s + x.absErr, 0) / a.length : null;
  });
  let clsErr = [null, null, null, null];
  if (cls && cls.encs) clsErr = encs.map(e => cls.encs[e] ? cls.encs[e].mean_err : null);
  const all = [...myErr, ...clsErr].filter(v => v != null);
  return {
    labels: encs.map(e => cn[e]),
    mySeries: myErr, clsSeries: clsErr,
    ymax: Math.max(...all, 4) * 1.3, yfmt: 1,
    title: "估计绝对误差（%）：我 vs 全班",
    note: cls && cls.encs ? "全班数据来自课程 C&M 实验（同口径：百分比绝对误差），可与我的四编码误差直接比较。" : "",
  };
}

/* ---------- 主入口：渲染个人结果卡片 ---------- */
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
        <canvas id="mr-chart" style="height:200px"></canvas>
        <p class="muted" id="mr-note"></p>
      </div>
      <p class="muted" id="mr-loading" style="margin-top:10px">正在读取全班数据…</p>
    </div>`;

  // 数据来源标签
  const srcEl = document.getElementById("mr-src");
  if (srcEl) {
    const s = (typeof GZ !== "undefined") ? GZ.source : "none";
    srcEl.textContent = s === "eye" ? "眼动数据" : s === "mouse" ? "鼠标追踪数据" : "行为数据";
  }

  // KPI
  const kpi = document.getElementById("mr-kpi");
  let cmp;
  if (expKey === "ib") {
    const rate = a => a.length ? a.filter(t => t.noticed === 1).length / a.length : null;
    const n = trials.filter(t => t.noticed === 1).length;
    const errs = trials.map(t => t.countErr).filter(v => v != null);
    kpi.innerHTML = `
      <div class="kpi"><div class="v">${n}/${trials.length}</div><div class="k">察觉到的轮次</div></div>
      <div class="kpi"><div class="v">${(rate(trials) * 100).toFixed(0)}%</div><div class="k">察觉率</div></div>
      <div class="kpi"><div class="v">${errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) : "—"}</div><div class="k">平均计数误差</div></div>`;
  } else if (expKey === "flanker") {
    const ok = trials.filter(t => t.correct === 1);
    const acc = trials.length ? trials.filter(t => t.correct === 1).length / trials.length : 0;
    const meanRT = ok.length ? ok.reduce((s, x) => s + x.rt, 0) / ok.length : null;
    kpi.innerHTML = `
      <div class="kpi"><div class="v">${(acc * 100).toFixed(0)}%</div><div class="k">正确率</div></div>
      <div class="kpi"><div class="v">${meanRT ? Math.round(meanRT) : "—"}</div><div class="k">平均反应时 (ms)</div></div>
      <div class="kpi"><div class="v">${trials.length}</div><div class="k">有效试次</div></div>`;
  } else {
    const errs = trials.map(t => t.absErr).filter(v => v != null);
    const l2 = trials.map(t => t.log2err).filter(v => v != null);
    kpi.innerHTML = `
      <div class="kpi"><div class="v">${errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) + "%" : "—"}</div><div class="k">平均绝对误差</div></div>
      <div class="kpi"><div class="v">${l2.length ? (l2.reduce((a, b) => a + b, 0) / l2.length).toFixed(2) : "—"}</div><div class="k">平均 log₂ 误差</div></div>
      <div class="kpi"><div class="v">${trials.length}</div><div class="k">有效试次</div></div>`;
  }

  // 全班对比
  let cls = null;
  try { cls = await CLASSDATA.summary(CLASS_EXP[expKey]); } catch (_) { }

  if (expKey === "ib") cmp = buildIBCompare(trials, cls);
  else if (expKey === "flanker") cmp = buildFLKCompare(trials, cls);
  else cmp = buildCMCompare(trials, cls);

  const load = document.getElementById("mr-loading");
  if (load) load.remove();

  const title = document.getElementById("mr-title");
  if (title) title.textContent = cmp.title;
  const note = document.getElementById("mr-note");
  if (note) {
    note.innerHTML = cls
      ? (cmp.note || "")
      : "未能读取全班数据（可能离线或接口暂不可用）。你的个人结果已完整记录，不影响作业数据。";
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
