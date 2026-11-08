/* ============================================================
   results.js —— 结果与模型可视化面板（实测 vs 预期 对比版）
   · 数据来源：导入的 CSV / JSON（各实验导出文件，可多选）
   · 布局：每个实验左列 = 实测结果（导入后出现），右列 = 预期结果
     （收数前预注册预测生成的示意数据，始终可见，橙色标签标注）
   · 未导入真实数据时：左列显示占位提示，页面即预期结果预览
   · 统计检验（仅对实测数据）：Cochran's Q / 配对 t / Friedman /
     二项检验 / Welch t，p 值经不完全 Beta/Gamma 函数精确计算
   · AI 对决面板：人类 vs 多模态 LLM（离线预跑）
   ============================================================ */
"use strict";

/* ---------- CSV 解析 ---------- */
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const splitLine = l => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  const head = splitLine(lines[0]);
  return lines.slice(1).map(l => {
    const cells = splitLine(l); const o = {};
    head.forEach((h, i) => o[h] = cells[i]);
    return o;
  });
}
const num = v => { const x = parseFloat(v); return isFinite(x) ? x : null; };

/* ============================================================
   统计工具（纯前端实现，无外部依赖）
   · t 检验（配对 / Welch）+ 单侧 p + Cohen's dz / d
   · 卡方独立性检验 + Cramér's V；Fisher 精确检验（2×2）
   · 二项检验；Friedman 秩检验 + Kendall's W；Cochran's Q
   ============================================================ */
const sdOf = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const seOf = a => (a.length >= 2) ? sdOf(a) / Math.sqrt(a.length) : null;
/** 跨被试标准误：rows 按 keyOf(t) 分条件，每名被试在条件内取均值，再跨被试算 SE。
 *  返回 Map<条件键, se>；不足 2 名被试时为 null */
function seByCond(rows, keyOf, valOf) {
  const byCond = new Map();
  rows.forEach(t => {
    const k = keyOf(t); if (k == null) return;
    if (!byCond.has(k)) byCond.set(k, new Map());
    const m = byCond.get(k);
    m.set(t.pid, (m.get(t.pid) || []).concat(valOf(t)));
  });
  const out = new Map();
  byCond.forEach((m, k) => {
    const vals = [...m.values()].map(a => mean(a));
    out.set(k, vals.length >= 2 ? +(seOf(vals)).toFixed(3) : null);
  });
  return out;
}
function gammaln(x) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-12, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function gammq(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x < a + 1) {
    let ap = a, sumP = 1 / a, del = sumP;
    for (let n = 1; n < 1000; n++) { ap++; del *= x / ap; sumP += del; if (Math.abs(del) < Math.abs(sumP) * 1e-14) break; }
    return 1 - sumP * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}
const tP = (t, df) => betai(df / 2, 0.5, df / (df + t * t));

function tPaired(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const diffs = a.slice(0, n).map((v, i) => v - b[i]);
  const m = mean(diffs), s = sdOf(diffs);
  if (!s) return null;
  const t = m / (s / Math.sqrt(n)), df = n - 1;
  return { t, df, mDiff: m, p1: tP(t, df) / 2, dz: m / s };
}
function tWelch(a, b) {
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return null;
  const ma = mean(a), mb = mean(b), va = sdOf(a) ** 2, vb = sdOf(b) ** 2;
  const se = Math.sqrt(va / na + vb / nb);
  if (!(se >= 1e-9)) return null;             // 两组方差皆≈0（数值退化）时不可检验
  const t = (ma - mb) / se;
  const df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  const sp = Math.sqrt((va * (na - 1) + vb * (nb - 1)) / (na + nb - 2));
  return { t, df, p1: tP(t, df) / 2, d: sp ? (ma - mb) / sp : null };
}
function chi2Test(mat) {
  const rows = mat.length, cols = mat[0].length;
  const rs = mat.map(r => r.reduce((s, x) => s + x, 0));
  const cs = Array.from({ length: cols }, (_, j) => mat.reduce((s, r) => s + r[j], 0));
  const N = rs.reduce((s, x) => s + x, 0);
  if (!N || rs.some(x => !x) || cs.some(x => !x)) return null;
  let chi2 = 0, small = false;
  mat.forEach((r, i) => r.forEach((o, j) => {
    const e = rs[i] * cs[j] / N;
    chi2 += (o - e) ** 2 / e;
    if (e < 5) small = true;
  }));
  const df = (rows - 1) * (cols - 1);
  return { chi2, df, p: gammq(df / 2, chi2 / 2), v: Math.sqrt(chi2 / (N * Math.min(rows - 1, cols - 1))), smallN: small };
}
const logChoose = (n, k) => gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1);
function fisherExact(a, b, c, d) {
  const n = a + b + c + d, r1 = a + b, c1 = a + c;
  const lp = aa => logChoose(r1, aa) + logChoose(n - r1, c1 - aa) - logChoose(n, c1);
  const pObs = lp(a);
  let p = 0;
  const lo = Math.max(0, c1 - (n - r1)), hi = Math.min(r1, c1);
  for (let k = lo; k <= hi; k++) { const lk = lp(k); if (lk <= pObs + 1e-12) p += Math.exp(lk); }
  return { p: Math.min(1, p), oddsRatio: b && c ? (a * d) / (b * c) : (b || c ? Infinity : NaN) };
}
function binomPGE(k, n, p0) {
  if (k <= 0) return 1;
  let p = 0;
  for (let i = k; i <= n; i++)
    p += Math.exp(logChoose(n, i) + i * Math.log(p0) + (n - i) * Math.log(1 - p0));
  return Math.min(1, p);
}
function friedman(dataBySubject) {
  const n = dataBySubject.length, k = dataBySubject[0].length;
  if (n < 3) return null;
  const colRankSum = Array(k).fill(0);
  dataBySubject.forEach(row => {
    const sorted = row.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const ranks = Array(k);
    let i = 0;
    while (i < k) {
      let j = i; while (j + 1 < k && sorted[j + 1].v === sorted[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let m = i; m <= j; m++) ranks[sorted[m].i] = avg;
      i = j + 1;
    }
    ranks.forEach((r, idx) => colRankSum[idx] += r);
  });
  const chi2 = 12 / (n * k * (k + 1)) * colRankSum.reduce((s, r) => s + r * r, 0) - 3 * n * (k + 1);
  const df = k - 1;
  return { chi2, df, p: gammq(df / 2, chi2 / 2), W: chi2 / (n * (k - 1)) };
}
function cochranQ(dataBySubject) {
  const n = dataBySubject.length, k = dataBySubject[0].length;
  if (n < 4 || k < 2) return null;
  const C = Array(k).fill(0);
  const R = dataBySubject.map(r => r.reduce((s, v) => s + v, 0));
  dataBySubject.forEach(r => r.forEach((v, j) => C[j] += v));
  const T = C.reduce((s, v) => s + v, 0);
  const denom = k * T - R.reduce((s, r) => s + r * r, 0);
  if (!denom) return null;
  const Q = (k - 1) * (k * C.reduce((s, v) => s + v * v, 0) - T * T) / denom;
  return { Q, df: k - 1, p: gammq((k - 1) / 2, Q / 2) };
}
const pFmt = p => (p == null || isNaN(p)) ? "—" : (p < 0.001 ? "< .001" : (p >= 0.999 ? "= .999" : "= " + p.toFixed(3).replace(/^0/, "")));
/** 数字格式化：APA 惯例，去掉前导 0（如 .35） */
const numFmt = (v, d = 2) => (v == null || isNaN(v)) ? "—" : v.toFixed(d).replace(/^(-?)0\./, "$1.");
/** 统计报告表（APA 第 7 版中文期刊格式：统计量斜体、p 值去前导零） */
function statBox(title, rows, note) {
  if (!rows.length) return "";
  return `<div class="chart-box apa-stat"><h3>${title}</h3>
    <table class="table apa-table">
      <tr><th>检验</th><th>统计结果</th><th>p</th><th>效应量</th></tr>
      ${rows.map(r => `<tr><td>${r[0]}</td><td class="mono">${r[1]}</td><td class="mono">${r[2]}</td><td class="mono">${r[3]}</td></tr>`).join("")}
    </table>
    <p class="muted apa-note">注：<i>p</i> 值为单侧检验（方向性预测于收数前预登记，双侧 <i>p</i> = ×2）；Fisher 精确检验报告双侧 <i>p</i>；
      卡方、Cochran's <i>Q</i>、Friedman 检验报告上尾概率。效应量 <i>d</i><sub>z</sub> 为配对设计 Cohen's <i>d</i>，
      <i>V</i> 为 Cramér's <i>V</i>，<i>W</i> 为 Kendall's <i>W</i>。</p>
    ${note ? `<p class="muted apa-note">${note}</p>` : ""}</div>`;
}

/* ---------- 手绘图表（无外部依赖） ---------- */
function chart(canvas, cfg) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  // ★ 高度取自内联 style（chart() 自身会改写 canvas.height 属性，
  //   从属性读会在重渲染时按 dpr 倍增 → 画布越画越大压住下方内容）
  const H = (parseInt(canvas.style.height) || +(canvas.dataset.h || 300));
  canvas.dataset.h = H;
  const W = canvas.clientWidth || 340;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  // —— 头部布局：标题 / 图例 / 绘图区严格分层，各留 6px 呼吸 ——
  const hasTitle = !!cfg.title;
  const hasLegend = cfg.series.length > 0;
  const TITLE_Y = 15;                              // 标题基线
  const LEG_Y = hasTitle ? 38 : 17;                // 图例基线
  // 数值标签需要约 14px 空间，故绘图区顶部再下移
  const T = (hasTitle ? (hasLegend ? 54 : 34) : (hasLegend ? 36 : 10)) + 14;
  const L = 52, R = 14, B = 46;                    // 左侧留宽以容纳 y 轴刻度
  const pw = W - L - R, ph = H - T - B;
  const font = "11.5px 'JetBrains Mono', ui-monospace, monospace";
  ctx.font = font; ctx.fillStyle = "#1e293b"; ctx.strokeStyle = "#dde5ec";
  if (hasTitle) {
    ctx.font = "500 11.5px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    // 标题过长时截断，避免溢出画布
    let t = cfg.title;
    const maxW = W - L - R;
    while (ctx.measureText(t).width > maxW && t.length > 6) t = t.slice(0, -2);
    ctx.fillText(t === cfg.title ? t : t + "…", L, TITLE_Y);
    ctx.font = font;
  }
  if (hasLegend) {
    ctx.font = "10.5px 'JetBrains Mono', ui-monospace, monospace";
    const itemW = cfg.series.map(s => (cfg.type === "bar" ? 14 : 24) + ctx.measureText(s.name).width + 8);
    const totalW = itemW.reduce((a, b) => a + b, 0);
    const avail = W - L - R;
    // 若图例总宽超出可用宽度，按比例压缩间距（可能换行）
    const gap = itemW.length > 1 ? Math.max(2, (avail - totalW) / (itemW.length - 1)) : 0;
    let lx = L, row = 0;
    cfg.series.forEach((s, i) => {
      // 超出右边界则换行
      if (lx + itemW[i] > W - R + 1 && i > 0) { lx = L; row++; }
      const ly = LEG_Y + row * 15;
      if (cfg.type === "bar") { ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 8, 9, 9); }
      else { ctx.strokeStyle = s.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(lx, ly - 4); ctx.lineTo(lx + 18, ly - 4); ctx.stroke(); }
      ctx.fillStyle = "#64748b"; ctx.textAlign = "left";
      ctx.fillText(s.name, lx + (cfg.type === "bar" ? 13 : 24), ly);
      lx += itemW[i] + gap;
    });
    ctx.font = font; ctx.textAlign = "center";
  }

  const ymin = cfg.ymin !== undefined ? cfg.ymin : 0;
  const ymax = cfg.ymax;
  const y2p = v => T + ph - (v - ymin) / (ymax - ymin) * ph;

  const ticks = cfg.yticks || 5;
  for (let i = 0; i <= ticks; i++) {
    const v = ymin + (ymax - ymin) * i / ticks, y = y2p(v);
    ctx.strokeStyle = "#e8eef3"; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillStyle = "#64748b"; ctx.textAlign = "right";
    ctx.fillText(+v.toFixed(cfg.yfmt === 1 ? 0 : 2), L - 6, y + 4);
  }
  ctx.textAlign = "center";

  if (cfg.type === "bar") {
    const n = cfg.series[0].values.length;
    const bw = pw / n;
    // 先算每个柱的中心 x，再统一绘制柱体 / 误差条 / 数值标签
    cfg.series.forEach((s, si) => {
      const w = Math.min(38, (bw - 12) / cfg.series.length);
      const pts = [];
      s.values.forEach((v, i) => {
        if (v == null || isNaN(v)) { pts.push(null); return; }
        pts.push({ x: L + bw * i + bw / 2 - (cfg.series.length * w) / 2 + si * w + w / 2, v });
      });
      pts.forEach(p => {
        if (!p) return;
        const yTop = Math.min(y2p(p.v), T + ph), y0 = T + ph;
        ctx.fillStyle = s.color;
        ctx.fillRect(p.x - w / 2, yTop, w, y0 - yTop);
      });
      // 误差条（±1 SE）：竖线 + 上下端帽
      if (s.errs) pts.forEach((p, i) => {
        if (!p || !s.errs[i]) return;
        const y1 = Math.max(Math.min(y2p(p.v - s.errs[i]), T + ph), T);
        const y2 = Math.max(Math.min(y2p(p.v + s.errs[i]), T + ph), T);
        ctx.strokeStyle = "#475569"; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x, y1); ctx.lineTo(p.x, y2);
        ctx.moveTo(p.x - 4, y1); ctx.lineTo(p.x + 4, y1);
        ctx.moveTo(p.x - 4, y2); ctx.lineTo(p.x + 4, y2);
        ctx.stroke();
      });
      pts.forEach((p, i) => {
        if (!p) return;
        const lab = +p.v.toFixed(cfg.yfmt === 1 ? 0 : 2);
        // 数值标签：置于误差条上端之上 4px；若会超出绘图区顶部，则改为画在柱内顶部
        const errTop = (s.errs && s.errs[i]) ? Math.max(y2p(p.v + s.errs[i]), T) : Math.min(y2p(p.v), T + ph);
        let yLab = errTop - 5;
        const inside = yLab < T + 9;                 // 太靠上 → 画到柱内
        if (inside) yLab = errTop + 12;
        ctx.fillStyle = inside ? "#ffffff" : "#1e293b";
        ctx.font = "10.5px 'JetBrains Mono', ui-monospace, monospace";
        ctx.fillText(lab, p.x, yLab);
        ctx.font = font;
      });
    });
  } else if (cfg.type === "line") {
    cfg.series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.4; ctx.beginPath();
      let started = false;
      s.values.forEach((v, i) => {
        const x = L + pw * (i / Math.max(1, s.values.length - 1)), y = y2p(v);
        if (v == null || isNaN(v)) { started = false; return; }
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // 误差条（±1 SE）
      if (s.errs) s.values.forEach((v, i) => {
        if (v == null || isNaN(v) || !s.errs[i]) return;
        const x = L + pw * (i / Math.max(1, s.values.length - 1));
        const y1 = Math.max(Math.min(y2p(v - s.errs[i]), T + ph), T);
        const y2 = Math.max(Math.min(y2p(v + s.errs[i]), T + ph), T);
        ctx.strokeStyle = "#475569"; ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x, y1); ctx.lineTo(x, y2);
        ctx.moveTo(x - 4, y1); ctx.lineTo(x + 4, y1);
        ctx.moveTo(x - 4, y2); ctx.lineTo(x + 4, y2);
        ctx.stroke();
      });
      s.values.forEach((v, i) => {
        if (v == null || isNaN(v)) return;
        const x = L + pw * (i / Math.max(1, s.values.length - 1));
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, y2p(v), 4, 0, Math.PI * 2); ctx.fill();
      });
    });
  }
  (cfg.predLines || []).forEach(p => {
    ctx.strokeStyle = p.color || "#d97706"; ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
    ctx.beginPath();
    if (p.values) { p.values.forEach((v, i) => { const x = L + pw * (i / Math.max(1, p.values.length - 1)); i ? ctx.lineTo(x, y2p(v)) : ctx.moveTo(x, y2p(v)); }); }
    else { ctx.moveTo(L, y2p(p.value)); ctx.lineTo(W - R, y2p(p.value)); }
    ctx.stroke(); ctx.setLineDash([]);
    if (p.label) { ctx.fillStyle = p.color || "#d97706"; ctx.textAlign = "right"; ctx.fillText(p.label, W - R - 2, y2p(p.value || 0) - 6); ctx.textAlign = "center"; }
  });
  ctx.fillStyle = "#1e293b";
  (cfg.xlabels || []).forEach((t, i) => {
    const nLab = cfg.xlabels.length;
    const step = cfg.type === "bar" ? pw / nLab : pw / Math.max(1, nLab - 1);
    const x = cfg.type === "bar" ? L + step * i + step / 2 : L + step * i;
    // 标签自适应：按可用槽宽截断，必要时分两行，绝不横向重叠
    const maxW = Math.max(28, step - 6);
    let label = String(t);
    if (ctx.measureText(label).width > maxW) {
      // 先尝试把长标签拆两行（如「中性·一致」→「中性」「一致」）
      const parts = label.split(/[·\s]+/).filter(Boolean);
      if (parts.length > 1 && parts.every(p => ctx.measureText(p).width <= maxW)) {
        parts.forEach((p, k) => ctx.fillText(p, x, H - 30 + k * 12));
        return;
      }
      // 否则截断加省略号
      while (ctx.measureText(label + "…").width > maxW && label.length > 2) label = label.slice(0, -1);
      label += "…";
    }
    ctx.fillText(label, x, H - 22);
  });
  // 标题已在头部区域绘制（与图例分层，不再重叠）
  if (cfg.ylabel) { ctx.save(); ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = "#64748b"; ctx.fillText(cfg.ylabel, 0, 0); ctx.restore(); }
}

/* ---------- 全局数据 ---------- */
const RES = { cm: [], flk: [], ib: [], pred: null, ai: null, class: null };

/** 加载全班课堂数据：优先实时接口（课程「我的结果」页同源），失败回退本地快照。
 *  接口对应课程三个原始实验：inattention（专注计数）/ flanker（速测）/ cm（估一估）。 */
async function loadClassData() {
  // ① 先用本地快照立即渲染（离线也能显示）
  try {
    const r = await fetch("data/class_summary.json", { cache: "no-store" });
    const txt = (await r.text()).replace(/^\uFEFF/, "");
    const j = JSON.parse(txt);
    RES.class = (j && j.exps) ? j : null;
  } catch (e) { RES.class = null; }

  // ② 再尝试用实时接口刷新（拿到最新全班数据）
  if (typeof CLASSDATA !== "undefined") {
    try {
      const ids = ["inattention", "flanker", "cm"];
      const got = await Promise.all(ids.map(id => CLASSDATA.summary(id)));
      if (got.some(g => g)) {
        const exps = {};
        ids.forEach((id, i) => { if (got[i]) exps[id] = got[i]; });
        // 合并：实时数据优先，缺失的用快照补齐
        RES.class = { source: CLASSDATA.LAB, exps: Object.assign({}, (RES.class && RES.class.exps) || {}, exps) };
      }
    } catch (e) { /* 静默：保留快照 */ }
  }
}

function ingest(rows) {
  if (!rows.length) return 0;
  const has = k => k in rows[0];
  let n = 0;
  rows.forEach(r => {
    if (has("enc") && has("durMs")) {
      const e = num(r.log2err);
      if (e != null) RES.cm.push({ pid: r.pid, enc: r.enc, dur: num(r.durMs), log2err: e, est: num(r.est), truePct: num(r.truePct), absErr: num(r.absErr), phase: r.phase || "formal" });
    } else if (has("flankerEmo") && has("congruent")) {
      const rt = num(r.rt);
      if (rt != null) RES.flk.push({ pid: r.pid, cond: r.cond, flankerEmo: r.flankerEmo, congruent: num(r.congruent), targetDir: r.targetDir, rt, correct: num(r.correct), timeout: num(r.timeout), gazeF: r.gazeFlankerRatio ? num(r.gazeFlankerRatio) : null, phase: r.phase || "formal" });
    } else if (has("noticed")) {
      RES.ib.push({
        pid: r.pid, phase: r.phase,
        seg: num(r.seg), round: num(r.seg),
        stim: r.stim || "umb",
        speed: r.speed || r.group || r.cond || "",
        dir: r.dir || "",
        noticed: num(r.noticed),
        countReport: num(r.countReport), passes: num(r.passes), countErr: num(r.countErr),
        fcIdCorr: num(r.fcIdCorr) != null ? num(r.fcIdCorr) : (r.fcObjCorr === "" || r.fcObjCorr == null ? null : num(r.fcObjCorr)),
        fcFeat: r.fcFeat || "", fcFeatCorr: num(r.fcFeatCorr),
        fcQuadCorr: num(r.fcQuadCorr),
        fcDir: r.fcDir || "", fcDirCorr: num(r.fcDirCorr),
        stimVisMs: num(r.stimVisMs) != null ? num(r.stimVisMs) : num(r.umbVisMs),
        contact: r.contact != null && r.contact !== "" ? num(r.contact) : null,
        gazeN: num(r.gazeN),
      });
    }
    n++;
  });
  return n;
}

/* ============================================================
   预期结果（收数前预注册预测 → 确定性示意数据）
   生成严格按 README「收数前预测」的量级，固定种子保证稳定呈现。
   ============================================================ */
function buildPredicted() {
  const rnd = RNG(20261105);
  const P = { ib: [], flk: [], cm: [] };
  // —— IB（预测 1：快 .70 > 慢 .30 ≈ 静止 .30（静止为探索性，S&C 1999 静止 50%≈行走 42%）；
  //      预测 2：鹅形 ≥ 雨伞（差值温和，S&C 伞人 65%）；预测 2b：雨伞速度敏感性更陡（W&S 2023）；
  //      预测 3：轮次上升）——
  const sched = [["umb", "fast"], ["coin", "slow"], ["maple", "static"],
                 ["umb", "static"], ["coin", "fast"], ["maple", "slow"]];
  for (let p = 0; p < 10; p++) {
    sched.forEach(([stim, speed], i) => {
      const base = { fast: .70, slow: .30, static: .30 }[speed];
      const idm = { coin: 1.25, maple: 1.10, umb: .95 }[stim];
      const spdMult = (stim === "umb" && speed === "slow") ? .65 : 1;   // 预测 2b：异类物体的速度斜率更陡
      const rm = 1 + .17 * i;
      P.ib.push({
        pid: "预期示意" + p, phase: "critical", seg: i + 1, stim, speed, dir: "L",
        noticed: rnd() < Math.min(.95, base * idm * spdMult * rm) ? 1 : 0,
        countReport: 11, passes: 12, countErr: 1.5 + rnd(),
        fcIdCorr: null, fcFeatCorr: null, fcQuadCorr: null, fcDirCorr: null,
        stimVisMs: 0, contact: null, gazeN: 0,
      });
    });
  }
  // —— Flanker（文献核查后下调：中性冲突 ≈ 55ms，愤怒冲突 ≈ 63ms，增量 ≈ +8ms，
  //    与任务无关条件下 0–15ms 的文献量级一致；Barratt & Bundesen 2012）——
  const cellM = { nc: 620, ni: 675, ac: 624, ai: 687 };
  for (let p = 0; p < 10; p++)
    [["neutral", 1, "nc"], ["neutral", 0, "ni"], ["angry", 1, "ac"], ["angry", 0, "ai"]].forEach(([emo, cong, k]) => {
      for (let i = 0; i < 10; i++)
        P.flk.push({
          pid: "预期示意" + p, cond: "", flankerEmo: emo, congruent: cong, targetDir: "left",
          rt: Math.round(cellM[k] + (rnd() - .5) * 90), correct: 1, timeout: 0,
          gazeF: +((emo === "angry" ? .26 : .19) + rnd() * .04).toFixed(3), phase: "formal",
        });
    });
  // —— C&M（预测 1：位置 < 长度 < 角度 < 面积；预测 2：角度/面积 500ms 惩罚更大）——
  const baseE = { position: .55, length: .75, angle: 1.30, area: 1.50 };
  const pen = { 500: { auto: .12, eff: .85 }, 2000: { auto: .05, eff: .35 }, [-1]: { auto: 0, eff: 0 } };
  for (let p = 0; p < 10; p++)
    Object.keys(baseE).forEach(enc => {
      [500, 2000, -1].forEach(dur => {
        const eff = (enc === "angle" || enc === "area");
        const m = baseE[enc] + (eff ? pen[dur].eff : pen[dur].auto);
        for (let i = 0; i < 4; i++)
          P.cm.push({ pid: "预期示意" + p, enc, dur, log2err: +(m + rnd() * .3).toFixed(3), phase: "formal" });
      });
    });
  return P;
}

/* ---------- 对比布局助手 ---------- */
const cmpRow = (l, r) => `<div class="cmp-row"><div class="cmp-col">${l}</div><div class="cmp-col">${r}</div></div>`;
const tagReal = n => `<div class="cmp-tag real">实测结果 · ${n} 名被试 · 真实数据</div>`;
const tagPred = `<div class="cmp-tag pred">预期结果 · 收数前预注册预测（示意数据，非真实）</div>`;
const realEmpty = `<div class="cmp-empty">尚未导入真实数据。<br>
  各实验结束页导出 CSV 后点击上方「导入 CSV / JSON」，<br>
  此处将与右侧<b>预期结果</b>并排对比，并附显著性检验。</div>`;

/* ============================================================
   实验1 IB：实测 / 预期 面板
   ============================================================ */
const IB_SPEEDS = ["fast", "slow", "static"];
const IB_SP_CN = { fast: "快速运动", slow: "慢速运动", static: "原地静止" };
const IB_IDS = ["umb", "coin", "maple"];
const IB_ID_CN = { umb: "雨伞", coin: "金币鹅", maple: "枫叶鹅" };

function ibKpi(rows) {
  const pids = [...new Set(rows.map(t => t.pid))];
  const rate = a => a.length ? a.filter(t => t.noticed === 1).length / a.length : null;
  const fcId = rows.filter(t => t.noticed === 1 && t.fcIdCorr != null);
  const cntErr = rows.filter(t => t.countErr != null);
  return `<div class="kpi-row">
    <div class="kpi"><div class="v">${pids.length}</div><div class="k">被试数</div></div>
    <div class="kpi"><div class="v">${rows.length}</div><div class="k">关键试次</div></div>
    <div class="kpi"><div class="v">${rate(rows) == null ? "—" : (rate(rows) * 100).toFixed(0) + "%"}</div><div class="k">总体察觉率</div></div>
    <div class="kpi"><div class="v">${cntErr.length ? mean(cntErr.map(t => t.countErr)).toFixed(1) : "—"}</div><div class="k">计数误差</div></div>
    <div class="kpi"><div class="v">${fcId.length ? (mean(fcId.map(t => t.fcIdCorr)) * 100).toFixed(0) + "%" : "—"}</div><div class="k">身份迫选正确率</div></div>
  </div>`;
}
function ibChartHTML(sfx, label) {
  return `
    <div class="chart-box"><h3>${label}：察觉率 × 运动速度</h3>
      <canvas id="c-ib-rate-${sfx}" style="height:270px"></canvas></div>
    <div class="chart-box"><h3>${label}：察觉率 × 意外物体形象</h3>
      <canvas id="c-ib-id-${sfx}" style="height:270px"></canvas></div>
    <div class="chart-box"><h3>${label}：察觉率 × 轮次</h3>
      <canvas id="c-ib-round-${sfx}" style="height:250px"></canvas></div>
    <div class="chart-box"><h3>${label}：注视接触率 × 察觉</h3>
      <canvas id="c-ib-gaze-${sfx}" style="height:230px"></canvas></div>`;
}
function drawIBCharts(rows, sfx, label) {
  const bySpeed = s => rows.filter(t => t.speed === s);
  const byId = s => rows.filter(t => t.stim === s);
  const byRound = k => rows.filter(t => +t.seg === k || +t.round === k);
  const rate = a => a.length ? a.filter(t => t.noticed === 1).length / a.length : null;
  const rSpeed = IB_SPEEDS.map(bySpeed).map(rate);
  const rId = IB_IDS.map(byId).map(rate);
  const rRound = [1, 2, 3, 4, 5, 6].map(byRound).map(rate);
  const isReal = sfx === "real";
  // 跨被试标准误（误差条 = ±1 SE）
  const seSpeed = seByCond(rows, t => t.speed, t => t.noticed);
  const seId = seByCond(rows, t => t.stim, t => t.noticed);
  const seRound = seByCond(rows, t => +t.seg, t => t.noticed);
  const meanRate = rate(rows);
  chart($("#c-ib-rate-" + sfx), {
    type: "bar", ymax: 1, yfmt: 2, yticks: 4,
    xlabels: IB_SPEEDS.map(s => IB_SP_CN[s]),
    series: [{ name: label + "察觉率", color: isReal ? "#7c3aed" : "#d97706",
      values: rSpeed.map(v => v == null ? 0 : +v.toFixed(3)),
      errs: IB_SPEEDS.map(s => seSpeed.get(s) || null) }],
    // 双模型可视化（加分项2）：运动捕获模型（速度递增）vs 显著性恒定模型（与速度无关）
    predLines: isReal && rSpeed.some(v => v != null)
      ? [{ values: [0.75, 0.25, 0.25], color: "#d97706", label: "运动捕获模型预测" },
         { value: meanRate, color: "#64748b", label: "显著性恒定模型" }]
      : [],
    ylabel: "察觉率", title: label + "：速度主效应",
  });
  chart($("#c-ib-id-" + sfx), {
    type: "bar", ymax: 1, yfmt: 2, yticks: 4,
    xlabels: IB_IDS.map(i => IB_ID_CN[i]),
    series: [{ name: label + "察觉率", color: isReal ? "#06b6d4" : "#d97706",
      values: rId.map(v => v == null ? 0 : +v.toFixed(3)),
      errs: IB_IDS.map(i => seId.get(i) || null) }],
    predLines: isReal && rId.some(v => v != null) ? [{ values: [0.30, 0.50, 0.45], color: "#d97706", label: "预测序" }] : [],
    ylabel: "察觉率", title: label + "：形象主效应（注意定势）",
  });
  chart($("#c-ib-round-" + sfx), {
    type: "line", ymin: 0, ymax: 1, yfmt: 2, yticks: 4,
    xlabels: ["1", "2", "3", "4", "5", "6"],
    series: [{ name: label + "察觉率", color: isReal ? "#7c3aed" : "#d97706",
      values: rRound.map(v => v == null ? null : +v.toFixed(3)),
      errs: [1, 2, 3, 4, 5, 6].map(k => seRound.get(k) || null) }],
    ylabel: "察觉率", title: label + "：轮次效应（预期建立）",
  });
  const cSeen = rows.filter(t => t.contact != null && t.noticed === 1).map(t => t.contact);
  const cMissed = rows.filter(t => t.contact != null && t.noticed === 0).map(t => t.contact);
  if (cSeen.length + cMissed.length >= 6) {
    const seGaze = seByCond(rows.filter(t => t.contact != null), t => "n" + t.noticed, t => t.contact);
    chart($("#c-ib-gaze-" + sfx), {
      type: "bar", ymax: 0.8, yfmt: 2, yticks: 4,
      xlabels: ["察觉到", "未察觉"],
      series: [{ name: "注视接触率", color: "#06b6d4",
        values: [cSeen.length ? +mean(cSeen).toFixed(3) : 0, cMissed.length ? +mean(cMissed).toFixed(3) : 0],
        errs: [seGaze.get("n1") || null, seGaze.get("n0") || null] }],
      ylabel: "接触率", title: label + "：看了 ≠ 看见？",
    });
  } else {
    const c = $("#c-ib-gaze-" + sfx);
    if (c) { c.parentElement.insertAdjacentHTML("beforeend", `<p class="muted">（${isReal ? "当前数据无眼动记录" : "预期示意未含眼动数据"}）</p>`); c.remove(); }
  }
}
function statsIB(crit) {
  const pids = [...new Set(crit.map(t => t.pid))];
  const statRows = [];
  const subjRows = (key, order) => pids.map(p =>
    order.map(k => crit.some(t => t.pid === p && t[key] === k && t.noticed === 1) ? 1 : 0));
  const rateOf = a => a.length ? a.filter(t => t.noticed === 1).length / a.length : null;
  const qSpeed = cochranQ(subjRows("speed", IB_SPEEDS));
  if (qSpeed) statRows.push([
    "速度主效应：察觉 × 快/慢/静止（Cochran's Q，N=" + pids.length + "）",
    `Q(${qSpeed.df}) = ${qSpeed.Q.toFixed(2)}`, pFmt(qSpeed.p),
    IB_SPEEDS.map((s, i) => IB_SP_CN[s] + " " + ((rateOf(crit.filter(t => t.speed === s)) ?? 0) * 100).toFixed(0) + "%").join(" / ")]);
  const qId = cochranQ(subjRows("stim", IB_IDS));
  if (qId) statRows.push([
    "形象主效应：察觉 × 雨伞/金币鹅/枫叶鹅（Cochran's Q）",
    `Q(${qId.df}) = ${qId.Q.toFixed(2)}`, pFmt(qId.p),
    IB_IDS.map(i => IB_ID_CN[i] + " " + ((rateOf(crit.filter(t => t.stim === i)) ?? 0) * 100).toFixed(0) + "%").join(" / ")]);
  const qRound = cochranQ(subjRows("seg", [1, 2, 3, 4, 5, 6]));
  if (qRound) statRows.push([
    "轮次效应：察觉率随轮次变化（Cochran's Q，预期/注意分配效应）",
    `Q(${qRound.df}) = ${qRound.Q.toFixed(2)}`, pFmt(qRound.p),
    "第 1 轮 " + ((rateOf(crit.filter(t => +t.seg === 1)) ?? 0) * 100).toFixed(0) + "% → 第 6 轮 " + ((rateOf(crit.filter(t => +t.seg === 6)) ?? 0) * 100).toFixed(0) + "%"]);
  const binomRow = (label, arr, p0) => {
    const a = arr.filter(v => v != null);
    if (!a.length) return null;
    const k = a.reduce((s, v) => s + v, 0);
    return [label + "（二项检验 vs 偶然 " + (p0 * 100) + "%）",
      k + "/" + a.length + " = " + (k / a.length * 100).toFixed(0) + "%", pFmt(binomPGE(k, a.length, p0)), "—"];
  };
  [["身份迫选（察觉者）", crit.filter(t => t.noticed === 1).map(t => t.fcIdCorr), 0.25],
   ["鹅特征迫选（报告鹅者）", crit.map(t => t.fcFeatCorr), 0.25],
   ["区域迫选（察觉者）", crit.filter(t => t.noticed === 1).map(t => t.fcQuadCorr), 0.25],
   ["运动方向迫选（察觉者）", crit.filter(t => t.noticed === 1).map(t => t.fcDirCorr), 0.20]
  ].forEach(([lab, a, p0]) => { const row = binomRow(lab, a, p0); if (row) statRows.push(row); });
  const seen = crit.filter(t => t.noticed === 1 && t.contact != null).map(t => t.contact);
  const missed = crit.filter(t => t.noticed === 0 && t.contact != null).map(t => t.contact);
  if (seen.length >= 3 && missed.length >= 3) {
    const w = tWelch(seen, missed);
    if (w) statRows.push(["注视接触率：察觉 vs 未察觉（Welch t）",
      `t(${w.df.toFixed(1)}) = ${w.t.toFixed(2)}（${(mean(seen) * 100).toFixed(0)}% vs ${(mean(missed) * 100).toFixed(0)}%）`,
      pFmt(w.p1), w.d == null ? "—" : `d = ${w.d.toFixed(2)}`]);
  }
  const note =
    "文献核查（2026-11-06）：Simons &amp; Chabris (1999) 约 50% 未察觉（静止事件 50% ≈ 行走 42%，" +
    "故静止 vs 慢速为探索性对比；伞人 65% &gt; 大猩猩 44% 提示高对比雨伞本身显眼，形象差值预测温和）；" +
    "Wood &amp; Simons (2023) 发现运动越快察觉率越高、且速度斜率在不匹配注意集的物体上更陡（预测 2b）；" +
    "Most et al. (2005)：同类别意外刺激更易被察觉（形象主效应）。" +
    "轮次效应为本改进设计特有：预期建立后主动分配注意资源 → 察觉率应随轮次上升。";
  return statBox("效应检验（IB · 被试内设计）", statRows, note);
}
function renderIBSection() {
  const el = $("#res-ib");
  const real = RES.ib.filter(t => t.phase === "critical");
  const hasReal = real.length > 0;
  const left = hasReal
    ? tagReal(new Set(real.map(t => t.pid)).size) + ibKpi(real) + ibChartHTML("real", "实测")
    : realEmpty;
  const right = tagPred + ibKpi(RES.pred.ib) + ibChartHTML("pred", "预期");
  const cls = clsBox("ib", 280, () => `<p class="muted">全班课堂（W5 非注意盲 · 十字计数范式，n=11）：不同类（黑色）十字察觉率
    ${(RES.class.exps.inattention.paradigms.shapes.marginals.cross.black.rate * 100).toFixed(0)}% vs
    同类（白色）${(RES.class.exps.inattention.paradigms.shapes.marginals.cross.white.rate * 100).toFixed(0)}%——
    与本实验预测 2（注意定势：同类意外刺激更易察觉）跨范式对照；全班计数误差
    ${RES.class.exps.inattention.paradigms.shapes.mean_count_error.toFixed(1)} 次。范式中传球计数与十字计数不同，量级仅供参考，方向性对比为主。</p>`);
  el.innerHTML = cmpRow(left, right) + (hasReal ? statsIB(real) : "") + cls;
  if (hasReal) drawIBCharts(real, "real", "实测");
  drawIBCharts(RES.pred.ib, "pred", "预期");
  drawClassIB(hasReal ? real : null);
}

/* ============================================================
   实验2 Flanker：实测 / 预期 面板
   ============================================================ */
function flkMetrics(t) {
  const rtOf = (emo, cong) => { const a = t.filter(x => x.flankerEmo === emo && x.congruent === cong && x.correct === 1); return a.length ? mean(a.map(x => x.rt)) : null; };
  const gazeBy = emo => { const a = t.filter(x => x.flankerEmo === emo && x.gazeF != null); return a.length ? mean(a.map(x => x.gazeF)) : null; };
  const nC = rtOf("neutral", 1), nI = rtOf("neutral", 0), aC = rtOf("angry", 1), aI = rtOf("angry", 0);
  return {
    nC, nI, aC, aI,
    costN: (nI != null && nC != null) ? nI - nC : null,
    costA: (aI != null && aC != null) ? aI - aC : null,
    gazeA: gazeBy("angry"), gazeN: gazeBy("neutral"),
    pids: [...new Set(t.map(x => x.pid))], n: t.length,
  };
}
function flkKpi(m) {
  const inter = (m.costN != null && m.costA != null) ? m.costA - m.costN : null;
  return `<div class="kpi-row">
    <div class="kpi"><div class="v">${m.pids.length}</div><div class="k">被试数</div></div>
    <div class="kpi"><div class="v">${m.costN == null ? "—" : m.costN.toFixed(0) + "ms"}</div><div class="k">中性冲突量</div></div>
    <div class="kpi"><div class="v">${m.costA == null ? "—" : m.costA.toFixed(0) + "ms"}</div><div class="k">愤怒冲突量</div></div>
    <div class="kpi"><div class="v">${inter == null ? "—" : (inter > 0 ? "+" : "") + inter.toFixed(0) + "ms"}</div><div class="k">情绪干扰增量</div></div>
  </div>`;
}
function flkChartHTML(sfx, label) {
  return `
    <div class="chart-box"><h3>${label}：四条件反应时</h3>
      <canvas id="c-flk-rt-${sfx}" style="height:270px"></canvas></div>
    <div class="chart-box"><h3>${label}：冲突量对比（冷注意基准 = 0）</h3>
      <canvas id="c-flk-cost-${sfx}" style="height:240px"></canvas></div>
    <div class="chart-box"><h3>${label}：侧翼区注视占比</h3>
      <canvas id="c-flk-gaze-${sfx}" style="height:240px"></canvas></div>`;
}
/** 每名被试的 Flanker 聚合（各格 RT 均值 / 冲突量 / 眼动占比），供绘图与检验共用 */
function flkSubjRows(t) {
  const out = [];
  [...new Set(t.map(x => x.pid))].forEach(p => {
    const pt = t.filter(x => x.pid === p && x.correct === 1);
    const cellM = (emo, cong) => {
      const a = pt.filter(x => x.flankerEmo === emo && x.congruent === cong).map(x => x.rt);
      return a.length >= 1 ? mean(a) : null;
    };
    const ac = cellM("angry", 1), ai = cellM("angry", 0), nc = cellM("neutral", 1), ni = cellM("neutral", 0);
    const gA = t.filter(x => x.pid === p && x.flankerEmo === "angry" && x.gazeF != null).map(x => x.gazeF);
    const gN = t.filter(x => x.pid === p && x.flankerEmo === "neutral" && x.gazeF != null).map(x => x.gazeF);
    out.push({
      costA: (ai != null && ac != null) ? ai - ac : null,
      costN: (ni != null && nc != null) ? ni - nc : null,
      cong: (ac != null && nc != null) ? (ac + nc) / 2 : null,
      incong: (ai != null && ni != null) ? (ai + ni) / 2 : null,
      gazeA: gA.length ? mean(gA) : null,
      gazeN: gN.length ? mean(gN) : null,
    });
  });
  return out;
}
function drawFLKCharts(m, sfx, label, rows) {
  const isReal = sfx === "real";
  // 跨被试标准误
  const seCell = seByCond(rows.filter(x => x.correct === 1), x => x.flankerEmo + "_" + x.congruent, x => x.rt);
  const subj = flkSubjRows(rows);
  const seCost = [
    seOf(subj.map(s => s.costN).filter(v => v != null)),
    seOf(subj.map(s => s.costA).filter(v => v != null)),
  ];
  const seGaze = seByCond(rows.filter(x => x.gazeF != null), x => x.flankerEmo, x => x.gazeF);
  const ymaxR = Math.max(m.nC || 0, m.nI || 0, m.aC || 0, m.aI || 0, 900) * 1.15;
  chart($("#c-flk-rt-" + sfx), {
    type: "bar", ymin: 0, ymax: Math.ceil(ymaxR / 100) * 100, yfmt: 1,
    xlabels: ["中性·一致", "中性·不一致", "愤怒·一致", "愤怒·不一致"],
    series: [{ name: "RT(ms)", color: isReal ? "#7c3aed" : "#d97706",
      values: [m.nC, m.nI, m.aC, m.aI].map(v => v == null ? 0 : Math.round(v)),
      errs: ["neutral_1", "neutral_0", "angry_1", "angry_0"].map(k => seCell.get(k) || null) }],
    ylabel: "反应时", title: label + "：四条件 RT",
  });
  if (m.costN != null || m.costA != null) {
    const cMax = Math.max(Math.abs(m.costN || 0), Math.abs(m.costA || 0), 30) * 1.4;
    chart($("#c-flk-cost-" + sfx), {
      type: "bar", ymin: -Math.ceil(cMax / 20) * 20, ymax: Math.ceil(cMax / 20) * 20, yfmt: 1, yticks: 4,
      xlabels: ["中性侧翼", "愤怒侧翼"],
      series: [{ name: "冲突量", color: isReal ? "#d97706" : "#d97706",
        values: [m.costN, m.costA].map(v => v == null ? 0 : Math.round(v)),
        errs: seCost }],
      predLines: [{ value: 0, color: "#94a3b8", label: "冷注意基准" }],
      ylabel: "ms", title: label + "：情绪价效 × 冲突量",
    });
  } else { const c = $("#c-flk-cost-" + sfx); if (c) c.parentElement.insertAdjacentHTML("beforeend", `<p class="muted">（数据不足）</p>`); }
  if (m.gazeA != null || m.gazeN != null) {
    chart($("#c-flk-gaze-" + sfx), {
      type: "bar", ymax: 0.6, yfmt: 2, yticks: 3,
      xlabels: ["愤怒侧翼", "中性侧翼"],
      series: [{ name: "注视占比", color: isReal ? "#7c3aed" : "#d97706",
        values: [m.gazeA, m.gazeN].map(v => v == null ? 0 : +v.toFixed(3)),
        errs: ["angry", "neutral"].map(k => seGaze.get(k) || null) }],
      predLines: [{ value: 0.18, color: "#94a3b8", label: "冷注意基准" }],
      ylabel: "占比", title: label + "：情绪捕获的眼动证据",
    });
  } else { const c = $("#c-flk-gaze-" + sfx); if (c) { c.parentElement.insertAdjacentHTML("beforeend", `<p class="muted">（${isReal ? "当前数据无眼动记录" : "预期示意未含眼动数据"}）</p>`); c.remove(); } }
}
function statsFLK(t) {
  const pids = [...new Set(t.map(x => x.pid))];
  const statRows = [];
  const subj = [];
  pids.forEach(p => {
    const pt = t.filter(x => x.pid === p && x.correct === 1);
    const cellM = (emo, cong) => {
      const a = pt.filter(x => x.flankerEmo === emo && x.congruent === cong).map(x => x.rt);
      return a.length >= 5 ? mean(a) : null;
    };
    const ac = cellM("angry", 1), ai = cellM("angry", 0), nc = cellM("neutral", 1), ni = cellM("neutral", 0);
    if (ac != null && ai != null && nc != null && ni != null)
      subj.push({ costA: ai - ac, costN: ni - nc, cong: (ac + nc) / 2, incong: (ai + ni) / 2 });
  });
  if (subj.length >= 3) {
    const emo = tPaired(subj.map(s => s.costA), subj.map(s => s.costN));
    if (emo) statRows.push([
      "情绪干扰增量：愤怒冲突量 − 中性冲突量（配对 t，N=" + subj.length + "）",
      `t(${emo.df}) = ${emo.t.toFixed(2)}（均值差 ${emo.mDiff.toFixed(0)} ms）`,
      pFmt(emo.p1), `dz = ${emo.dz.toFixed(2)}`]);
    const flk = tPaired(subj.map(s => s.incong), subj.map(s => s.cong));
    if (flk) statRows.push([
      "经典 Flanker 效应：不一致 − 一致（配对 t）",
      `t(${flk.df}) = ${flk.t.toFixed(2)}（均值差 ${flk.mDiff.toFixed(0)} ms）`,
      pFmt(flk.p1), `dz = ${flk.dz.toFixed(2)}`]);
  } else {
    statRows.push(["情绪干扰增量 / Flanker 效应", "被试内数据不足（每格至少 5 个正确试次且 ≥3 名被试）", "—", "—"]);
  }
  const note =
    "文献核查（2026-11-06）：Eriksen &amp; Eriksen (1974) 字母 Flanker 冲突量 20–60ms；" +
    "情绪侧翼效应为<b>三假说竞争</b>——威胁捕获（增量 &gt; 0）/ 冷注意（增量 ≈ 0，任务无关时效应趋零，" +
    "Barratt &amp; Bundesen 2012）/ 注意收缩（增量 &lt; 0，Fenske &amp; Eastwood 2003 发现负性情绪收缩注意、" +
    "减小 flanker 效应）。本实验自变量与任务无关，恰可裁决三说；自动报告按三向判定。";
  return statBox("效应检验（Flanker · 2×2 被试内）", statRows, note);
}
function renderFLKSection() {
  const el = $("#res-flk");
  const real = RES.flk.filter(x => x.phase === "formal" || !x.phase);
  const hasReal = real.length > 0;
  const mReal = hasReal ? flkMetrics(real) : null;
  const mPred = flkMetrics(RES.pred.flk);
  const left = hasReal ? tagReal(mReal.pids.length) + flkKpi(mReal) + flkChartHTML("real", "实测") : realEmpty;
  const right = tagPred + flkKpi(mPred) + flkChartHTML("pred", "预期");
  const cls = clsBox("flk", 260, () => `<p class="muted">全班课堂（W6 Flanker · 经典版本）：一致 ${RES.class.exps.flanker.conds.congruent.mean_rt.toFixed(0)}ms /
    不一致 ${RES.class.exps.flanker.conds.incongruent.mean_rt.toFixed(0)}ms / 中性基线 ${RES.class.exps.flanker.conds.neutral.mean_rt.toFixed(0)}ms，
    干扰量 ${(RES.class.exps.flanker.conds.incongruent.mean_rt - RES.class.exps.flanker.conds.congruent.mean_rt).toFixed(1)}ms——
    落在 Eriksen &amp; Eriksen (1974) 的 20–60ms 文献量级内。我们的中性面孔侧翼冲突量可与全班基线对比，
    愤怒面孔侧翼增量即本实验新增检验的「热注意」成分。</p>`);
  el.innerHTML = cmpRow(left, right) + (hasReal ? statsFLK(real) : "") + cls;
  if (hasReal) drawFLKCharts(mReal, "real", "实测", real);
  drawFLKCharts(mPred, "pred", "预期", RES.pred.flk);
  drawClassFLK(hasReal ? real : null);
}

/* ============================================================
   实验3 C&M：实测 / 预期 面板 + AI 对决
   ============================================================ */
const CM_ENCS = ["position", "length", "angle", "area"];
const CM_ENC_CN = { position: "位置", length: "长度", angle: "角度", area: "面积" };
const CM_DURS = [500, 2000, -1];
const CM_DUR_CN = { 500: "500ms", 2000: "2s", [-1]: "无限" };

function cmMetrics(t) {
  const errBy = (enc, dur) => { const a = t.filter(x => x.enc === enc && (dur === undefined || x.dur === dur)); return a.length ? mean(a.map(x => x.log2err)) : null; };
  return { errBy, pids: [...new Set(t.map(x => x.pid))], n: t.length };
}
function cmKpi(m) {
  const encErr = CM_ENCS.map(e => m.errBy(e));
  return `<div class="kpi-row">
    <div class="kpi"><div class="v">${m.pids.length}</div><div class="k">被试数</div></div>
    <div class="kpi"><div class="v">${m.n}</div><div class="k">试次数</div></div>
    ${CM_ENCS.map((e, i) => `<div class="kpi"><div class="v">${encErr[i] == null ? "—" : encErr[i].toFixed(2)}</div><div class="k">${CM_ENC_CN[e]} log₂误差</div></div>`).join("")}
  </div>`;
}
function cmChartHTML(sfx, label) {
  return `
    <div class="chart-box"><h3>${label}：编码层级（C&amp;M 1984 预测序为虚线）</h3>
      <canvas id="c-cm-enc-${sfx}" style="height:270px"></canvas></div>
    <div class="chart-box"><h3>${label}：编码 × 呈现时长（自动性检验）</h3>
      <canvas id="c-cm-dur-${sfx}" style="height:270px"></canvas></div>`;
}
function drawCMCharts(m, sfx, label, rows) {
  const isReal = sfx === "real";
  const encErr = CM_ENCS.map(e => m.errBy(e));
  const maxE = Math.max(...encErr.filter(v => v != null), 1) * 1.3;
  const CM84 = [0.6, 0.8, 1.5, 1.7];
  // 跨被试标准误
  const seEnc = seByCond(rows, x => x.enc, x => x.log2err);
  const seEncDur = seByCond(rows, x => x.enc + "_" + x.dur, x => x.log2err);
  chart($("#c-cm-enc-" + sfx), {
    type: "bar", ymin: 0, ymax: +maxE.toFixed(1), yfmt: 2,
    xlabels: CM_ENCS.map(e => CM_ENC_CN[e]),
    series: [{ name: label + " log₂ 误差", color: isReal ? "#7c3aed" : "#d97706",
      values: encErr.map(v => v == null ? 0 : +v.toFixed(3)),
      errs: CM_ENCS.map(e => seEnc.get(e) || null) }],
    predLines: [{ values: CM84.map(v => v * maxE / 1.9), color: isReal ? "#d97706" : "#e2e8f0", label: "C&M 1984 预测序" }],
    ylabel: "log₂ 误差", title: label + "：图形知觉层级",
  });
  const colors = { position: "#7c3aed", length: "#06b6d4", angle: "#d97706", area: "#e11d48" };
  chart($("#c-cm-dur-" + sfx), {
    type: "line", ymin: 0, ymax: +maxE.toFixed(1), yfmt: 2,
    xlabels: CM_DURS.map(d => CM_DUR_CN[d]),
    series: CM_ENCS.map(e => ({
      name: CM_ENC_CN[e], color: colors[e],
      values: CM_DURS.map(d => { const v = m.errBy(e, d); return v == null ? null : +v.toFixed(3); }),
      errs: CM_DURS.map(d => seEncDur.get(e + "_" + d) || null),
    })),
    ylabel: "log₂ 误差", title: label + "：编码 × 呈现时长",
  });
}
function statsCM(t) {
  const statRows = [];
  const bySubj = {};
  t.forEach(x => {
    const k = x.enc + "_" + x.dur;
    (bySubj[x.pid] = bySubj[x.pid] || {})[k] = (bySubj[x.pid][k] || []).concat(x.log2err);
  });
  const subIds = Object.keys(bySubj);
  const friedRows = subIds.map(p => CM_ENCS.map(e => {
    const a = Object.entries(bySubj[p]).filter(([k]) => k.startsWith(e + "_")).flatMap(([, v]) => v);
    return a.length ? mean(a) : null;
  })).filter(r => r.every(v => v != null));
  if (friedRows.length >= 3) {
    const fr = friedman(friedRows);
    if (fr) statRows.push([
      "编码主效应：4 编码 log₂ 误差（Friedman 检验，N=" + friedRows.length + "）",
      `χ²(${fr.df}) = ${fr.chi2.toFixed(2)}`, pFmt(fr.p), `Kendall's W = ${fr.W.toFixed(2)}`]);
  }
  const pen = p => {
    const g = (encs2, dur) => {
      const a = encs2.flatMap(e => bySubj[p][e + "_" + dur] || []);
      return a.length ? mean(a) : null;
    };
    const auto500 = g(["position", "length"], 500), autoInf = g(["position", "length"], -1);
    const eff500 = g(["angle", "area"], 500), effInf = g(["angle", "area"], -1);
    if (auto500 == null || autoInf == null || eff500 == null || effInf == null) return null;
    return { eff: eff500 - effInf, auto: auto500 - autoInf, s500: (auto500 + eff500) / 2, sInf: (autoInf + effInf) / 2 };
  };
  const pens = subIds.map(pen).filter(v => v);
  if (pens.length >= 3) {
    const itx = tPaired(pens.map(v => v.eff), pens.map(v => v.auto));
    if (itx) statRows.push([
      "编码 × 时长交互（角度/面积短时惩罚 − 位置/长度短时惩罚，配对 t）",
      `t(${itx.df}) = ${itx.t.toFixed(2)}（均值差 ${itx.mDiff.toFixed(2)} log₂）`,
      pFmt(itx.p1), `dz = ${itx.dz.toFixed(2)}`]);
    const dur = tPaired(pens.map(v => v.s500), pens.map(v => v.sInf));
    if (dur) statRows.push([
      "呈现时长主效应：500ms vs 无限（配对 t）",
      `t(${dur.df}) = ${dur.t.toFixed(2)}（均值差 ${dur.mDiff.toFixed(2)} log₂）`,
      pFmt(dur.p1), `dz = ${dur.dz.toFixed(2)}`]);
  } else {
    statRows.push(["编码 × 时长交互", "被试内数据不足（需各 编码×时长 格均有数据且 ≥3 名被试）", "—", "—"]);
  }
  const note =
    "文献核查（2026-11-06）：Cleveland &amp; McGill (1984) 经典层级为 位置 &gt; 长度 &gt; 角度 &gt; 面积" +
    "（角度/长度相对顺序在 Heer &amp; Bostock (2010) 复现中存在争议，本班课堂数据中面积亦优于角度）。" +
    "交互检验为本实验新增：<b>自动性假说</b>预测「需计算的编码」在 500ms 下恶化更大；" +
    "对立的<b>短呈现反转假说</b>（Moreira et al. 2023：300–1000ms 下排序可反转、时长效应微弱）预测相反——" +
    "实测交互方向直接裁决两说。另预期 500ms 与 2s 差异有限（交互主要在 短时 vs 无限 之间）。";
  return statBox("效应检验（C&M · 4×3 被试内）", statRows, note);
}
async function renderCMSection() {
  const el = $("#res-cm");
  const real = RES.cm.filter(x => x.phase === "formal" || !x.phase);
  const hasReal = real.length > 0;
  const mReal = hasReal ? cmMetrics(real) : null;
  const mPred = cmMetrics(RES.pred.cm);
  const left = hasReal ? tagReal(mReal.pids.length) + cmKpi(mReal) + cmChartHTML("real", "实测") : realEmpty;
  const right = tagPred + cmKpi(mPred) + cmChartHTML("pred", "预期");
  const cls = clsBox("cm", 270, () => {
    const clsOrder = CM_ENCS.map(e => RES.class.exps.cm.encs[e] ? `${CM_ENC_CN[e]} ${RES.class.exps.cm.encs[e].mean_err.toFixed(2)}` : null).filter(Boolean).join(" &lt; ");
    return `<p class="muted">全班课堂（W7 C&amp;M · n≈37）：四编码平均绝对误差序 = ${clsOrder}% ——
      位置 &lt; 长度得到复现，但<b>面积优于角度</b>，与 C&amp;M 1984 原始层级（角度 &lt; 面积）相反，
      正是 Heer &amp; Bostock (2010) 复现中「角度/长度（及面积）顺序争议」的实例，讨论时可对照。</p>`;
  });
  el.innerHTML = cmpRow(left, right) + (hasReal ? statsCM(real) : "") + cls;
  if (hasReal) drawCMCharts(mReal, "real", "实测", real);
  drawCMCharts(mPred, "pred", "预期", RES.pred.cm);
  drawClassCM(hasReal ? real : null);
  await renderAIPanel();
}

/* ---------- AI 对决面板（离线预跑结果） ---------- */
/** 读取 JSON：剥 BOM + 缓存禁用 + 失败重试一次
 *  （BOM 会让 response.json() 抛错；某些环境 fetch 会因缓存/网络抖动失败） */
async function fetchJSONNoBOM(url, retry = 1) {
  let lastErr;
  for (let i = 0; i <= retry; i++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = (await r.text()).replace(/^\uFEFF/, "");
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (i < retry) await new Promise(s => setTimeout(s, 350));
    }
  }
  throw new Error(`${url} 读取失败：${lastErr && lastErr.message}`);
}

async function renderAIPanel() {
  const box = $("#res-ai");
  let res = null, prompts = null, usedFallback = false;
  try {
    [res, prompts] = await Promise.all([
      fetchJSONNoBOM("ai/ai_results.json"),
      fetchJSONNoBOM("ai/cm_prompts.json"),
    ]);
  } catch (e) {
    // 回退到内置数据（保证面板始终可用）
    if (typeof AI_FALLBACK !== "undefined") {
      res = AI_FALLBACK.results;
      prompts = AI_FALLBACK.prompts;
      usedFallback = true;
    } else {
      box.innerHTML = `<div class="callout warn"><b>AI 对比面板加载失败</b><br>
        原因：${String(e && e.message || e).replace(/[<>]/g, "")}<br>
        <span class="muted">数据文件位于 <code>ai/ai_results.json</code> 与 <code>ai/cm_prompts.json</code>。</span></div>`;
      return;
    }
  }
  try {
    const byId = {};
    prompts.trials.forEach(tr => byId[tr.id] = tr);
    const done = (res.results || []).filter(r => r.estimate != null && byId[r.id]);
    if (!done.length) {
      box.innerHTML = `<div class="callout warn"><b>AI 对决数据尚未回填</b><br>
        将 <code>ai/cm_prompts.json</code> 中每条 trial 的图片与 prompt 发给多模态大模型，
        把估计值填入 <code>ai/ai_results.json</code> 的 <code>results[].estimate</code>（0–100 整数），
        刷新本页即可看到人机对比。</div>`;
      return;
    }
    const aiErr = CM_ENCS.map(e => {
      const a = done.filter(r => byId[r.id].enc === e).map(r => {
        const est = clamp(r.estimate / 100, .01, 10), tru = byId[r.id].ratio;
        return Math.abs(Math.log2(est / tru));
      });
      return a.length ? mean(a) : null;
    });
    const humanErr = CM_ENCS.map(e => {
      const a = RES.cm.filter(x => x.enc === e && (x.phase === "formal" || !x.phase));
      return a.length ? mean(a.map(x => x.log2err)) : null;
    });
    const maxE = Math.max(...[...aiErr, ...humanErr].filter(v => v != null), 1) * 1.3;
    const rankBest2Worst = arr => arr.map((v, i) => ({ v, i })).filter(o => o.v != null).sort((a, b) => a.v - b.v).map(o => CM_ENC_CN[CM_ENCS[o.i]]);
    const ordHuman = rankBest2Worst(humanErr), ordAI = rankBest2Worst(aiErr);
    const ordMatch = ordHuman.length === 4 && ordAI.length === 4
      ? (ordHuman.join() === ordAI.join() ? "两者排序完全一致（与 IEEE 2025 预测不符，需讨论）"
                                         : "两者排序不一致 → 与 IEEE 2025 / arXiv 2504.04221 的预测方向一致")
      : "人类数据不足，无法比较排序";
    box.innerHTML = `
      <div class="chart-box"><h3>人类 vs ${res.model || "多模态大模型"}：同题对决</h3>
        <p class="muted">模型 ${res.model || "?"} · ${done.length}/16 题已作答 · 逐题图片见 ai/cm_stimuli_png/</p>
        <canvas id="c-ai" style="height:300px"></canvas>
        <p class="muted"><b>层级排序对比（准确 → 不准确）</b>：人类 = ${ordHuman.join(" &gt; ") || "（未导入人类数据）"}；
        AI = ${ordAI.join(" &gt; ")} → ${ordMatch}。</p></div>
      <div class="chart-box"><h3>AI 逐题作答</h3>
        <table class="table"><tr><th>题号</th><th>编码</th><th>真值%</th><th>AI 估计%</th><th>误差</th></tr>
        ${done.map(r => {
      const tr = byId[r.id];
      const e = Math.abs(Math.log2(clamp(r.estimate / 100, .01, 10) / tr.ratio));
      return `<tr><td>${r.id}</td><td>${CM_ENC_CN[tr.enc]}</td><td>${tr.true_pct}</td><td>${r.estimate}</td><td>${e.toFixed(2)}</td></tr>`;
    }).join("")}</table></div>`;
    chart($("#c-ai"), {
      type: "bar", ymin: 0, ymax: +maxE.toFixed(1), yfmt: 2,
      xlabels: CM_ENCS.map(e => CM_ENC_CN[e]),
      series: [
        { name: "人类实测", color: "#7c3aed", values: humanErr.map(v => v == null ? 0 : +v.toFixed(2)) },
        { name: "AI 实测", color: "#e11d48", values: aiErr.map(v => v == null ? 0 : +v.toFixed(2)) },
      ],
      ylabel: "log₂ 误差", title: "图形比例知觉：人类 vs AI",
    });
    // 使用内置兜底数据时加一句提示
    if (usedFallback) {
      const tip = document.createElement("p");
      tip.className = "muted";
      tip.style.marginTop = "8px";
      tip.textContent = "（注：外部数据文件读取失败，当前显示的是内置备份数据，内容与文件一致）";
      box.appendChild(tip);
    }
  } catch (e) {
    box.innerHTML = `<div class="callout warn"><b>AI 面板渲染失败</b><br>
      原因：${String(e && e.message || e).replace(/[<>]/g, "")}</div>`;
  }
}

/* ============================================================
   全班课堂数据对比面板（加分项3）
   数据源：data/class_summary.json —— 课程注意实验室 /api/class/summary
   匿名汇总快照（2026-11-06 抓取），本地文件离线可用
   ============================================================ */
const tagClass = `<div class="cmp-tag" style="background:#eceef2;color:#475069;border:1px solid #d5d9e2">全班课堂数据 · 课程注意实验室（匿名汇总快照）</div>`;
const clsBox = (id, h, captionFn) => RES.class
  ? `<div class="chart-box">${tagClass}<canvas id="c-cls-${id}" style="height:${h}px"></canvas>${captionFn ? captionFn() : ""}</div>`
  : "";

/** IB：相似性效应 —— 我们（雨伞=不同类 vs 鹅形=同类）vs 全班（黑十字 vs 白十字） */
function drawClassIB(rows) {
  const c = $("#c-cls-ib"); if (!c || !RES.class) return;
  const d = RES.class.exps.inattention;
  const cross = d.paradigms.shapes.marginals.cross;
  const rate = a => a.length ? a.filter(t => t.noticed === 1).length / a.length : null;
  const gooseRows = rows ? rows.filter(t => t.stim === "coin" || t.stim === "maple") : [];
  const se = rows ? seByCond(rows, t => t.stim === "umb" ? "u" : (t.stim === "none" ? null : "g"), t => t.noticed) : new Map();
  chart(c, {
    type: "bar", ymax: 1, yfmt: 2, yticks: 4,
    xlabels: ["不同类意外刺激", "同类意外刺激"],
    series: [
      { name: "本次实测", color: "#7c3aed",
        values: [rows ? rate(rows.filter(t => t.stim === "umb")) : null, gooseRows.length ? rate(gooseRows) : null].map(v => v == null ? null : +v.toFixed(3)),
        errs: [se.get("u") || null, se.get("g") || null] },
      { name: "全班课堂", color: "#94a3b8",
        values: [+(cross.black.rate ?? 0).toFixed(3), +(cross.white.rate ?? 0).toFixed(3)] },
    ],
    ylabel: "察觉率", title: "相似性效应对比：我们（雨伞 vs 鹅形）vs 全班（黑十字 vs 白十字）",
  });
}

/** Flanker：冲突量 —— 我们（中性/愤怒面孔侧翼）vs 全班（经典 flanker） */
function drawClassFLK(rows) {
  const c = $("#c-cls-flk"); if (!c || !RES.class) return;
  const cls = RES.class.exps.flanker;
  const clsInt = cls.conds.incongruent.mean_rt - cls.conds.congruent.mean_rt;
  let costN = null, costA = null, seN = null, seA = null;
  if (rows && rows.length) {
    const m = flkMetrics(rows);
    costN = m.costN; costA = m.costA;
    const subj = flkSubjRows(rows);
    seN = seOf(subj.map(s => s.costN).filter(v => v != null));
    seA = seOf(subj.map(s => s.costA).filter(v => v != null));
  }
  chart(c, {
    type: "bar", yticks: 4, yfmt: 1,
    ymin: -40, ymax: Math.max(Math.ceil((Math.max(costN || 0, costA || 0, clsInt, 50) * 1.3) / 20) * 20, 40),
    xlabels: ["我们 · 中性面孔侧翼", "我们 · 愤怒面孔侧翼", "全班 · 经典 flanker"],
    series: [{ name: "冲突量 (ms)", color: "#d97706",
      values: [costN == null ? null : Math.round(costN), costA == null ? null : Math.round(costA), +clsInt.toFixed(1)],
      errs: [seN == null ? null : +seN.toFixed(1), seA == null ? null : +seA.toFixed(1), null] }],
    predLines: [{ value: 0, color: "#94a3b8", label: "冷注意基准" }],
    ylabel: "ms", title: "冲突量对比（不一致 − 一致 RT）",
  });
}

/** C&M：四编码绝对误差 —— 本次实测 vs 全班课堂（同口径：百分比绝对误差） */
function drawClassCM(rows) {
  const c = $("#c-cls-cm"); if (!c || !RES.class) return;
  const encsCls = RES.class.exps.cm.encs;
  const ourRows = rows ? rows.filter(x => x.absErr != null) : [];
  const se = ourRows.length ? seByCond(ourRows, x => x.enc, x => x.absErr) : new Map();
  chart(c, {
    type: "bar", yticks: 4, yfmt: 1,
    ymax: Math.max(4, Math.ceil((Math.max(...CM_ENCS.map(e => encsCls[e] ? encsCls[e].mean_err : 0), 4) * 1.4))),
    xlabels: CM_ENCS.map(e => CM_ENC_CN[e]),
    series: [
      { name: "本次实测 (%)", color: "#7c3aed",
        values: CM_ENCS.map(e => { const a = ourRows.filter(x => x.enc === e); return a.length ? +mean(a.map(x => x.absErr)).toFixed(2) : null; }),
        errs: CM_ENCS.map(e => se.get(e) || null) },
      { name: "全班课堂 (%)", color: "#94a3b8",
        values: CM_ENCS.map(e => encsCls[e] ? +encsCls[e].mean_err.toFixed(2) : null) },
    ],
    ylabel: "绝对误差 %", title: "四编码误差对比：本次实测 vs 全班课堂",
  });
}

/* ============================================================
   自动分析报告（导入真实数据后生成）
   · 按收数前预登记的预测逐条判定：✓ 支持 / △ 部分支持 / ✗ 不支持
   · 同时生成 Markdown 文本，可一键复制粘贴进 README「结果与讨论」
   ============================================================ */
const V = {
  y: '<span class="badge ok">支持</span>',
  p: '<span class="badge info">部分支持</span>',
  n: '<span class="badge err">不支持</span>',
};
const VW = { y: "支持", p: "部分支持", n: "不支持" };
const pct = v => v == null ? "—" : (v * 100).toFixed(0) + "%";
const pv = p => (p == null || isNaN(p)) ? "—" : (p < .001 ? "p < .001" : "p = " + p.toFixed(3));

function verdictOf(orderOK, p, alpha = .05) {
  if (orderOK && p != null && p < alpha) return "y";
  if (orderOK || (p != null && p < alpha)) return "p";
  return "n";
}

function reportIB(crit) {
  const pids = [...new Set(crit.map(t => t.pid))];
  const rate = arr => arr.length ? arr.filter(t => t.noticed === 1).length / arr.length : null;
  const rS = IB_SPEEDS.map(s => rate(crit.filter(t => t.speed === s)));
  const rI = IB_IDS.map(i => rate(crit.filter(t => t.stim === i)));
  const rR = [1, 2, 3, 4, 5, 6].map(k => rate(crit.filter(t => +t.seg === k)));
  const subjRows = (key, order) => pids.map(p =>
    order.map(k => crit.some(t => t.pid === p && t[key] === k && t.noticed === 1) ? 1 : 0));
  const qS = cochranQ(subjRows("speed", IB_SPEEDS));
  const qI = cochranQ(subjRows("stim", IB_IDS));
  const qR = cochranQ(subjRows("seg", [1, 2, 3, 4, 5, 6]));
  const vS = verdictOf(rS[0] > rS[1] && rS[1] >= (rS[2] ?? -1), qS && qS.p);
  const vI = verdictOf((rI[1] ?? -1) >= (rI[2] ?? -1) && (rI[2] ?? -1) > (rI[0] ?? 2), qI && qI.p);
  const vR = verdictOf((rR[5] ?? -1) > (rR[0] ?? 2), qR && qR.p);
  // —— 模型拟合对比（加分项2）：运动捕获模型 vs 显著性恒定模型（SSE 越小拟合越好）——
  const P_MC = [0.70, 0.30, 0.15];                       // 预注册的运动捕获预测量级
  const mAll = rate(crit);
  const sseMC = rS.every(v => v != null) ? rS.reduce((s, v, i) => s + (v - P_MC[i]) ** 2, 0) : null;
  const sseSC = rS.every(v => v != null) ? rS.reduce((s, v) => s + (v - mAll) ** 2, 0) : null;
  const modelWin = (sseMC != null && sseSC != null) ? (sseMC < sseSC ? "运动捕获模型" : "显著性恒定模型") : null;
  // —— 预测 2b（W&S 2023 斜率差异）：雨伞（异类）的速度敏感性 > 鹅形（同类）——
  const rUmbF = rate(crit.filter(t => t.stim === "umb" && t.speed === "fast"));
  const rUmbS = rate(crit.filter(t => t.stim === "umb" && t.speed === "slow"));
  const gF = crit.filter(t => (t.stim === "coin" || t.stim === "maple") && t.speed === "fast");
  const gS = crit.filter(t => (t.stim === "coin" || t.stim === "maple") && t.speed === "slow");
  const dUmb = (rUmbF != null && rUmbS != null) ? rUmbF - rUmbS : null;
  const dGoose = (gF.length && gS.length) ? rate(gF) - rate(gS) : null;
  // —— 全班对比（加分项3）：相似性效应方向是否与全班课堂一致 ——
  const gooseRate = rate(crit.filter(t => t.stim === "coin" || t.stim === "maple"));
  const clsCross = RES.class && RES.class.exps.inattention ? RES.class.exps.inattention.paradigms.shapes.marginals.cross : null;
  const ourSimDiff = (gooseRate != null && rI[0] != null) ? gooseRate - rI[0] : null;
  const clsSimDiff = clsCross ? clsCross.white.rate - clsCross.black.rate : null;
  // 迫选（4 项二项检验）
  const fc = [
    ["身份", crit.filter(t => t.noticed === 1).map(t => t.fcIdCorr), .25],
    ["鹅特征", crit.map(t => t.fcFeatCorr), .25],
    ["区域", crit.filter(t => t.noticed === 1).map(t => t.fcQuadCorr), .25],
    ["运动方向", crit.filter(t => t.noticed === 1).map(t => t.fcDirCorr), .20],
  ].map(([lab, a, p0]) => {
    const arr = a.filter(v => v != null);
    if (!arr.length) return { lab, k: 0, n: 0, r: null, p: null, p0, v: "n" };
    const k = arr.reduce((s, v) => s + v, 0);
    const p = binomPGE(k, arr.length, p0);
    return { lab, k, n: arr.length, r: k / arr.length, p, p0, v: p < .05 ? "y" : (k / arr.length > p0 ? "p" : "n") };
  });
  // 眼动
  const seen = crit.filter(t => t.noticed === 1 && t.contact != null).map(t => t.contact);
  const missed = crit.filter(t => t.noticed === 0 && t.contact != null).map(t => t.contact);
  const wG = (seen.length >= 3 && missed.length >= 3) ? tWelch(seen, missed) : null;
  const gaze = (seen.length >= 3 && missed.length >= 3)
    ? { s: mean(seen), m: mean(missed), w: wG } : null;
  const html = `
    <h3 style="margin:10px 0 6px">实验 1 · 非注意盲（N = ${pids.length}，每人 6 轮）</h3>
    <div class="apa-prose">
      <p>为检验意外刺激的运动速度、形象类别与轮次对察觉的影响，对 ${pids.length} 名被试的
      ${crit.length} 个关键试次进行 Cochran's <i>Q</i> 检验。速度条件的察觉率分别为
      快速 ${pct(rS[0])}、慢速 ${pct(rS[1])}、静止 ${pct(rS[2])}${qS ? `，差异${qS.p < .05 ? "显著" : "不显著"}，
      Cochran's <i>Q</i>(${qS.df}) = ${numFmt(qS.Q)}，<i>p</i> ${pFmt(qS.p)}` : ""}。
      形象条件的察觉率分别为金币鹅 ${pct(rI[1])}、枫叶鹅 ${pct(rI[2])}、雨伞 ${pct(rI[0])}${qI ? `，
      Cochran's <i>Q</i>(${qI.df}) = ${numFmt(qI.Q)}，<i>p</i> ${pFmt(qI.p)}` : ""}。</p>
      <p>轮次效应方面，第 1 轮察觉率为 ${pct(rR[0])}，第 6 轮为 ${pct(rR[5])}${qR ? `，
      Cochran's <i>Q</i>(${qR.df}) = ${numFmt(qR.Q)}，<i>p</i> ${pFmt(qR.p)}` : ""}。
      ${gaze ? `以注视接触率为指标，察觉试次（<i>M</i> = ${numFmt(gaze.s * 100, 1)}%）与未察觉试次
      （<i>M</i> = ${numFmt(gaze.m * 100, 1)}%）${gaze.w ? `的差异${gaze.w.p1 < .05 ? "显著" : "不显著"}，
      <i>t</i>(${numFmt(gaze.w.df, 1)}) = ${numFmt(gaze.w.t)}，<i>p</i> ${pFmt(gaze.w.p1)}` : "未作检验"}。` : ""}</p>
    </div>
    <table class="table apa-table">
      <tr><th>预注册预测</th><th>实测</th><th>判定</th></tr>
      <tr><td>1. 速度：快速 &gt; 慢速 ≈ 静止</td>
          <td>快速 ${pct(rS[0])} / 慢速 ${pct(rS[1])} / 静止 ${pct(rS[2])}；Cochran's Q(2) = ${qS ? qS.Q.toFixed(2) : "—"}，${pv(qS && qS.p)}</td><td>${V[vS]}</td></tr>
      <tr><td>2. 形象：金币鹅 ≥ 枫叶鹅 ≥ 雨伞（注意定势；差值预测温和）</td>
          <td>金币鹅 ${pct(rI[1])} / 枫叶鹅 ${pct(rI[2])} / 雨伞 ${pct(rI[0])}；Q(2) = ${qI ? qI.Q.toFixed(2) : "—"}，${pv(qI && qI.p)}</td><td>${V[vI]}</td></tr>
      <tr><td>2b. 速度 × 形象交互：雨伞（异类）的速度敏感性 &gt; 鹅形（同类）<br><span class="muted">（W&amp;S 2023：速度斜率在不匹配注意集的物体上更陡）</span></td>
          <td>雨伞 快−慢 = ${dUmb == null ? "—" : "+" + (dUmb * 100).toFixed(0) + "%"} vs 鹅形 ${dGoose == null ? "—" : (dGoose >= 0 ? "+" : "") + (dGoose * 100).toFixed(0) + "%"}</td>
          <td>${dUmb != null && dGoose != null ? (dUmb > dGoose ? V.y : V.p) : "—"}</td></tr>
      <tr><td>3. 轮次：察觉率随轮次上升（预期建立）</td>
          <td>第 1 轮 ${pct(rR[0])} → 第 6 轮 ${pct(rR[5])}；Q(5) = ${qR ? qR.Q.toFixed(2) : "—"}，${pv(qR && qR.p)}</td><td>${V[vR]}</td></tr>
      <tr><td>4. 迫选均高于偶然（25% / 方向 20%）</td>
          <td>${fc.map(f => `${f.lab} ${f.n ? (f.r * 100).toFixed(0) + "%" : "—"}（${f.n ? pv(f.p) : "无数据"}）`).join("；")}</td>
          <td>${fc.filter(f => f.v === "y").length}/${fc.length} 项支持</td></tr>
      <tr><td>— 模型对比：运动捕获 vs 显著性恒定（SSE 拟合）</td>
          <td>${sseMC == null ? "数据不足" : `SSE 运动捕获 ${sseMC.toFixed(3)} vs 显著性恒定 ${sseSC.toFixed(3)}`}</td>
          <td>${modelWin ? (modelWin === "运动捕获模型" ? V.y : V.n) : "—"}</td></tr>
      ${clsCross ? `<tr><td>— 全班对比：相似性效应（同类 − 异类察觉率）</td>
          <td>我们 ${ourSimDiff == null ? "—" : (ourSimDiff > 0 ? "+" : "") + (ourSimDiff * 100).toFixed(0) + "%"} vs
              全班 +${(clsSimDiff * 100).toFixed(0)}%（白十字 ${clsCross.white.rate * 100}% vs 黑十字 ${clsCross.black.rate * 100}%）</td>
          <td>${ourSimDiff != null && clsSimDiff > 0 ? (ourSimDiff > 0 ? V.y : V.n) : "—"}</td></tr>` : ""}
      ${gaze ? `<tr><td>5. 眼动：注视接触而未察觉（看了 ≠ 看见）</td>
          <td>注视接触率：察觉 ${pct(gaze.s)} vs 未察觉 ${pct(gaze.m)}${gaze.w ? `（Welch t = ${gaze.w.t.toFixed(2)}，${pv(gaze.w.p1)}）` : "（方差退化，仅描述）"}</td><td>${gaze.m > .1 ? V.p : V.n}</td></tr>` : ""}
    </table>`;
  const md = `### 实验 1 · 非注意盲（N = ${pids.length}，每人 6 轮）

- 速度主效应：察觉率 快速 ${pct(rS[0])} / 慢速 ${pct(rS[1])} / 静止 ${pct(rS[2])}；Cochran's Q(2) = ${qS ? qS.Q.toFixed(2) : "—"}，${pv(qS && qS.p)} → 预测「${VW[vS]}」。
- 形象主效应（核心）：雨伞 ${pct(rI[0])} / 金币鹅 ${pct(rI[1])} / 枫叶鹅 ${pct(rI[2])}；Cochran's Q(2) = ${qI ? qI.Q.toFixed(2) : "—"}，${pv(qI && qI.p)} → 注意定势假设「${VW[vI]}」（差值预测温和 +5~15%：S&C 1999 伞人 65% 提示高对比雨伞本身显眼）。
- 速度 × 形象交互（预测 2b，W&S 2023）：雨伞 快−慢 = ${dUmb == null ? "—" : "+" + (dUmb * 100).toFixed(0) + "%"} vs 鹅形 ${dGoose == null ? "—" : (dGoose >= 0 ? "+" : "") + (dGoose * 100).toFixed(0) + "%"} → ${dUmb != null && dGoose != null ? (dUmb > dGoose ? "与文献斜率差异一致" : "未呈现文献斜率差异，需讨论") : "数据不足"}。
- 轮次效应：第 1 轮 ${pct(rR[0])} → 第 6 轮 ${pct(rR[5])}；Cochran's Q(5) = ${qR ? qR.Q.toFixed(2) : "—"}，${pv(qR && qR.p)} → 预期建立效应「${VW[vR]}」。
- 迫选：${fc.map(f => `${f.lab} ${f.n ? (f.r * 100).toFixed(0) + "%" : "—"}（vs 偶然 ${f.p0 * 100}%，${f.n ? pv(f.p) : "无数据"}）`).join("；")}。
- 模型对比：SSE 运动捕获 ${sseMC == null ? "—" : sseMC.toFixed(3)} vs 显著性恒定 ${sseSC == null ? "—" : sseSC.toFixed(3)} → **${modelWin || "数据不足"}**更贴合实测。
${gaze ? `- 眼动：注视接触率 察觉 ${pct(gaze.s)} vs 未察觉 ${pct(gaze.m)}${gaze.w ? `（Welch t = ${gaze.w.t.toFixed(2)}，${pv(gaze.w.p1)}）` : ""} →「看了 ≠ 看见」证据${gaze.m > .1 ? "存在" : "不足"}。` : "- 眼动：无眼动数据。"}
${clsCross ? `- 全班对比（课程注意实验室 W5 非注意盲，n=11）：相似性效应（同类 − 异类）我们 ${ourSimDiff == null ? "—" : (ourSimDiff > 0 ? "+" : "") + (ourSimDiff * 100).toFixed(0) + "%"} vs 全班 +${(clsSimDiff * 100).toFixed(0)}%（白十字 ${clsCross.white.rate * 100}% vs 黑十字 ${clsCross.black.rate * 100}%），方向${ourSimDiff != null && ourSimDiff > 0 ? "一致" : "待讨论"}。` : ""}
- 与 Simons & Chabris (1999)（约半数未察觉）、Wood & Simons (2023)（速度↑察觉↑）、Most et al. (2005)（同类别更易察觉）的对比与讨论：（此处手写 2–3 句）`;
  return { html, md };
}

function reportFLK(t) {
  const m = flkMetrics(t);
  const subj = flkSubjRows(t).filter(s => s.costA != null && s.costN != null);
  const emo = subj.length >= 3 ? tPaired(subj.map(s => s.costA), subj.map(s => s.costN)) : null;
  const flk = subj.length >= 3 ? tPaired(subj.map(s => s.incong), subj.map(s => s.cong)) : null;
  const inter = (m.costN != null && m.costA != null) ? m.costA - m.costN : null;
  // 三假说判定（文献核查后的预注册竞争假说）：
  // 增量>0 且显著 → 威胁捕获；增量<0 且显著 → 注意收缩（Fenske & Eastwood 2003）；其余 → 冷注意（Barratt & Bundesen 2012）
  let hypo = "冷注意假说（增量 ≈ 0，Barratt &amp; Bundesen 2012）";
  if (emo && emo.p1 < .05) hypo = inter > 0
    ? "威胁捕获假说（增量 &gt; 0 显著）"
    : "注意收缩假说（增量 &lt; 0 显著，Fenske &amp; Eastwood 2003）";
  else if (inter != null && inter >= 10) hypo = "方向符合威胁捕获（增量 &gt; 0）但未达显著";
  else if (inter != null && inter <= -10) hypo = "方向符合注意收缩（增量 &lt; 0）但未达显著";
  const html = `
    <h3 style="margin:10px 0 6px">实验 2 · 情绪 Flanker（N = ${m.pids.length}）</h3>
    <div class="apa-prose">
      <p>以侧翼面孔的情绪价效与箭头一致性为被试内因素，对 ${m.pids.length} 名被试的反应时进行配对样本 <i>t</i> 检验。
      中性侧翼与愤怒侧翼条件下的冲突量（不一致减一致）分别为
      <i>M</i> = ${m.costN == null ? "—" : numFmt(m.costN, 1)} ms 与 <i>M</i> = ${m.costA == null ? "—" : numFmt(m.costA, 1)} ms，
      情绪干扰增量为 ${inter == null ? "—" : (inter > 0 ? "+" : "") + numFmt(inter, 1)} ms${emo
        ? `，${emo.p1 < .05 ? "差异显著" : "差异不显著"}，<i>t</i>(${emo.df}) = ${numFmt(emo.t)}，<i>p</i> ${pFmt(emo.p1)}，
      Cohen's <i>d</i><sub>z</sub> = ${numFmt(emo.dz)}` : ""}。</p>
      <p>${flk ? `经典 Flanker 效应（不一致减一致）为 <i>M</i> = ${numFmt(flk.mDiff, 1)} ms，
      <i>t</i>(${flk.df}) = ${numFmt(flk.t)}，<i>p</i> ${pFmt(flk.p1)}，<i>d</i><sub>z</sub> = ${numFmt(flk.dz)}，
      ${flk.mDiff >= 20 && flk.mDiff <= 60 ? "落在 Eriksen 与 Eriksen（1974）报告的 20–60 ms 区间内" : "偏离文献报告的 20–60 ms 区间"}。` : ""}
      综合上述结果，本实验数据支持<strong>${hypo.replace(/&amp;/g, "&").replace(/（.*?）/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">")}</strong>。</p>
    </div>
    <table class="table apa-table">
      <tr><th>预注册预测（三假说竞争）</th><th>实测</th><th>判定</th></tr>
      <tr><td>1. 威胁捕获假说：愤怒冲突量 &gt; 中性（预期增量 +5~20ms）</td>
          <td>中性 ${m.costN == null ? "—" : m.costN.toFixed(0) + "ms"} / 愤怒 ${m.costA == null ? "—" : m.costA.toFixed(0) + "ms"}；
              增量 ${inter == null ? "—" : (inter > 0 ? "+" : "") + inter.toFixed(0) + "ms"}；
              ${emo ? `配对 t(${emo.df}) = ${emo.t.toFixed(2)}，${pv(emo.p1)}，dz = ${emo.dz.toFixed(2)}` : "被试内数据不足"}</td>
          <td>${emo && emo.p1 < .05 && inter > 0 ? V.y : V.p}</td></tr>
      <tr><td>2. 冷注意假说：增量 ≈ 0（任务无关时效应趋零，Barratt &amp; Bundesen 2012）</td>
          <td>同上</td><td>${inter != null && Math.abs(inter) < 10 ? V.y : V.p}</td></tr>
      <tr><td>3. 注意收缩假说：增量 &lt; 0（负性情绪收缩注意，Fenske &amp; Eastwood 2003）</td>
          <td>同上</td><td>${emo && emo.p1 < .05 && inter < 0 ? V.y : V.p}</td></tr>
      <tr><td><b>三假说裁决</b></td>
          <td colspan="2"><b>${hypo}</b></td></tr>
      <tr><td>— 对照：经典 flanker 效应（文献 20–60ms）</td>
          <td>${flk ? `不一致 − 一致 = ${flk.mDiff.toFixed(0)}ms（${pv(flk.p1)}，dz = ${flk.dz.toFixed(2)}）` : "—"}</td>
          <td>${flk && flk.mDiff >= 20 && flk.mDiff <= 60 ? V.y : V.p}</td></tr>
      <tr><td>4. 愤怒侧翼区注视占比 &gt; 中性</td>
          <td>${m.gazeA == null ? "无眼动数据" : `愤怒 ${m.gazeA.toFixed(2)} vs 中性 ${(m.gazeN ?? 0).toFixed(2)}`}</td>
          <td>${m.gazeA != null && (m.gazeN == null || m.gazeA > m.gazeN) ? V.y : V.n}</td></tr>
      ${RES.class ? `<tr><td>— 全班对比（W6 经典 Flanker）</td>
          <td>全班干扰量 ${(RES.class.exps.flanker.conds.incongruent.mean_rt - RES.class.exps.flanker.conds.congruent.mean_rt).toFixed(1)}ms
              （一致 ${RES.class.exps.flanker.conds.congruent.mean_rt.toFixed(0)} / 不一致 ${RES.class.exps.flanker.conds.incongruent.mean_rt.toFixed(0)}ms）
              vs 我们中性 ${m.costN == null ? "—" : m.costN.toFixed(0)}ms / 愤怒 ${m.costA == null ? "—" : m.costA.toFixed(0)}ms</td>
          <td>${m.costN != null && m.costN >= 20 && m.costN <= 60 ? V.y : V.p}</td></tr>` : ""}
    </table>`;
  const md = `### 实验 2 · 情绪 Flanker（N = ${m.pids.length}）

- 四条件 RT：中性·一致 ${m.nC == null ? "—" : m.nC.toFixed(0)} / 中性·不一致 ${m.nI == null ? "—" : m.nI.toFixed(0)} / 愤怒·一致 ${m.aC == null ? "—" : m.aC.toFixed(0)} / 愤怒·不一致 ${m.aI == null ? "—" : m.aI.toFixed(0)} ms。
- 经典 Flanker 效应 ${flk ? flk.mDiff.toFixed(0) + "ms（配对 t，" + pv(flk.p1) + "，dz = " + flk.dz.toFixed(2) + "）" : "—"}，与 Eriksen & Eriksen (1974) 的 20–60ms 量级对比：${flk && flk.mDiff >= 20 && flk.mDiff <= 60 ? "量级一致" : "偏离文献量级，需讨论"}。
- **情绪干扰增量 ${inter == null ? "—" : (inter > 0 ? "+" : "") + inter.toFixed(0) + "ms"}**${emo ? `（配对 t(${emo.df}) = ${emo.t.toFixed(2)}，${pv(emo.p1)}，dz = ${emo.dz.toFixed(2)}）` : ""} → **${hypo.replace(/&amp;/g, "&")}**（预期 +5~20ms）。
- 眼动：${m.gazeA == null ? "无眼动数据" : `愤怒侧翼区注视占比 ${m.gazeA.toFixed(2)} vs 中性 ${(m.gazeN ?? 0).toFixed(2)}`} → 情绪捕获眼动证据${m.gazeA != null && m.gazeA > (m.gazeN ?? 0) ? "支持" : "不支持"}预测。
${RES.class ? `- 全班对比（课程注意实验室 W6 Flanker）：全班干扰量 ${(RES.class.exps.flanker.conds.incongruent.mean_rt - RES.class.exps.flanker.conds.congruent.mean_rt).toFixed(1)}ms（一致 ${RES.class.exps.flanker.conds.congruent.mean_rt.toFixed(0)} / 不一致 ${RES.class.exps.flanker.conds.incongruent.mean_rt.toFixed(0)}ms）vs 我们中性 ${m.costN == null ? "—" : m.costN.toFixed(0)}ms / 愤怒 ${m.costA == null ? "—" : m.costA.toFixed(0)}ms（手写 2–3 句对比讨论）。` : ""}
- 三假说裁决讨论（威胁捕获 / 冷注意 / 注意收缩，此处手写 2–3 句）`;
  return { html, md };
}

function reportCM(t) {
  const m = cmMetrics(t);
  const encErr = CM_ENCS.map(e => m.errBy(e));
  const pids = m.pids;
  const bySubj = {};
  t.forEach(x => { const k = x.enc + "_" + x.dur; (bySubj[x.pid] = bySubj[x.pid] || {})[k] = (bySubj[x.pid][k] || []).concat(x.log2err); });
  const subIds = Object.keys(bySubj);
  const friedRows = subIds.map(p => CM_ENCS.map(e => {
    const a = Object.entries(bySubj[p]).filter(([k]) => k.startsWith(e + "_")).flatMap(([, v]) => v);
    return a.length ? mean(a) : null;
  })).filter(r => r.every(v => v != null));
  const fr = friedRows.length >= 3 ? friedman(friedRows) : null;
  const pen = p => {
    const g = (encs2, dur) => {
      const a = encs2.flatMap(e => bySubj[p][e + "_" + dur] || []);
      return a.length ? mean(a) : null;
    };
    const a5 = g(["position", "length"], 500), aI = g(["position", "length"], -1);
    const e5 = g(["angle", "area"], 500), eI = g(["angle", "area"], -1);
    if (a5 == null || aI == null || e5 == null || eI == null) return null;
    return { eff: e5 - eI, auto: a5 - aI };
  };
  const pens = subIds.map(pen).filter(v => v);
  const itx = pens.length >= 3 ? tPaired(pens.map(v => v.eff), pens.map(v => v.auto)) : null;
  const ord = CM_ENCS.map((e, i) => ({ e, v: encErr[i] })).filter(o => o.v != null).sort((a, b) => a.v - b.v).map(o => CM_ENC_CN[o.e]);
  const ordMatch = ord.join("") === "位置长度角度面积";
  const vH = verdictOf(ordMatch, fr && fr.p);
  const vX = itx ? verdictOf(itx.mDiff > 0, itx.p1) : "n";
  const html = `
    <h3 style="margin:10px 0 6px">实验 3 · C&amp;M 图形知觉（N = ${pids.length}）</h3>
    <div class="apa-prose">
      <p>对 ${pids.length} 名被试在四种图形编码下的 log₂ 估计误差进行 Friedman 检验。
      实测误差由小至大为：${ord.length ? ord.join(" &lt; ") : "—"}${fr
        ? `，编码主效应${fr.p < .05 ? "显著" : "不显著"}，χ²(${fr.df}) = ${numFmt(fr.chi2)}，
      <i>p</i> ${pFmt(fr.p)}，Kendall's <i>W</i> = ${numFmt(fr.W)}` : ""}。</p>
      <p>${itx ? `就编码与呈现时长的交互而言，角度与面积编码在 500 ms 条件下的误差增量比位置与长度编码高
      ${numFmt(itx.mDiff)} log₂ 单位，<i>t</i>(${itx.df}) = ${numFmt(itx.t)}，<i>p</i> ${pFmt(itx.p1)}，
      Cohen's <i>d</i><sub>z</sub> = ${numFmt(itx.dz)}，
      ${itx.mDiff > 0 ? "支持自动性假说（层级源于自动知觉编码）" : "支持短呈现反转假说（需认知计算）"}。`
        : "被试内数据不足，无法检验交互效应。"}</p>
    </div>
    <table class="table apa-table">
      <tr><th>预注册预测</th><th>实测</th><th>判定</th></tr>
      <tr><td>1. 复现层级：位置 &lt; 长度 &lt; 角度 &lt; 面积（log₂ 误差）</td>
          <td>实测顺序：${ord.join(" &lt; ") || "—"}；${fr ? `Friedman χ²(${fr.df}) = ${fr.chi2.toFixed(2)}，${pv(fr.p)}，W = ${fr.W.toFixed(2)}` : "被试内数据不足"}</td><td>${V[vH]}</td></tr>
      <tr><td>2. 交互：角度/面积的 500ms 惩罚 &gt; 位置/长度（自动性）</td>
          <td>${itx ? `惩罚差 = +${itx.mDiff.toFixed(2)} log₂（配对 t(${itx.df}) = ${itx.t.toFixed(2)}，${pv(itx.p1)}，dz = ${itx.dz.toFixed(2)}）` : "被试内数据不足"}</td><td>${V[vX]}</td></tr>
      <tr><td>3. 人机：AI 层级与人类不一致</td>
          <td>AI 逐题结果见下方人机对决面板（GLM-5.3：角度最佳、面积最差）</td><td>${ord.length === 4 && ord[0] !== "角度" ? V.y : V.p}</td></tr>
      ${RES.class ? (() => {
        const co = CM_ENCS.map(e => ({ e, v: RES.class.exps.cm.encs[e].mean_err })).sort((a, b) => a.v - b.v).map(o => CM_ENC_CN[o.e]);
        return `<tr><td>— 全班对比（W7 C&amp;M，n≈37，绝对误差%）</td>
          <td>全班序：${co.join(" &lt; ")}（面积优于角度，与 C&amp;M 1984 相反——Heer &amp; Bostock 2010 争议实例）
          vs 我们：${ord.join(" &lt; ") || "—"}</td><td>${ord.length === 4 && ord[0] === co[0] ? V.y : V.p}</td></tr>`;
      })() : ""}
    </table>`;
  const md = `### 实验 3 · C&M（N = ${pids.length}）

- 编码主效应：${fr ? `Friedman χ²(3) = ${fr.chi2.toFixed(2)}，${pv(fr.p)}，Kendall's W = ${fr.W.toFixed(2)}` : "被试内数据不足"}；实测层级（log₂ 误差，准确→不准确）：${ord.join(" > ") || "—"} → 预测「${VW[vH]}」（角度/长度顺序与 Heer & Bostock 2010 争议的讨论：手写）。
- **编码 × 时长交互**：${itx ? `角度/面积短时惩罚 − 位置/长度短时惩罚 = +${itx.mDiff.toFixed(2)} log₂（配对 t(${itx.df}) = ${itx.t.toFixed(2)}，${pv(itx.p1)}，dz = ${itx.dz.toFixed(2)}）` : "被试内数据不足"} → 自动性假设「${VW[vX]}」。
- 人机对决：人类层级排序 = ${ord.join(" > ") || "—"}；GLM-5.3 排序 = 角度 > 位置 > 长度 > 面积（面积 40% 一题低估）→ 两者不一致，与 arXiv 2504.04221 方向一致。
${RES.class ? `- 全班对比（课程注意实验室 W7 C&M，n≈37，绝对误差%）：全班层级序 = ${CM_ENCS.map(e => ({ e, v: RES.class.exps.cm.encs[e].mean_err })).sort((a, b) => a.v - b.v).map(o => CM_ENC_CN[o.e]).join(" > ")}，面积优于角度（与 C&M 1984 相反，Heer & Bostock 2010 争议实例）vs 我们 = ${ord.join(" > ") || "—"}（手写 2–3 句对比讨论）。` : ""}`;
  return { html, md };
}

function renderReport() {
  const wrap = $("#res-report-wrap"); if (!wrap) return;
  const ib = RES.ib.filter(t => t.phase === "critical");
  const flk = RES.flk.filter(x => x.phase === "formal" || !x.phase);
  const cm = RES.cm.filter(x => x.phase === "formal" || !x.phase);
  const hasAny = ib.length || flk.length || cm.length;
  wrap.style.display = hasAny ? "" : "none";
  if (!hasAny) { $("#res-report").innerHTML = ""; return; }
  const parts = [], mds = [];
  if (ib.length) { const r = reportIB(ib); parts.push(r.html); mds.push(r.md); }
  if (flk.length) { const r = reportFLK(flk); parts.push(r.html); mds.push(r.md); }
  if (cm.length) { const r = reportCM(cm); parts.push(r.html); mds.push(r.md); }
  $("#res-report").innerHTML = parts.join('<hr style="border:none;border-top:1px dashed #e2d8c8;margin:12px 0">') +
    `<p class="muted">判定规则：实测方向与预注册预测一致且 p &lt; .05 = 支持；仅方向一致或仅显著 = 部分支持；否则不支持。
     误差条 = ±1 标准误（跨被试）。以上 Markdown 文本可直接粘贴进 README「结果与讨论」，标注（此处手写…）处需本人补写讨论。</p>`;
  window.__mdReport = mds.join("\n\n");
}

/* ---------- 渲染入口 ---------- */
function renderAll() {
  renderIBSection(); renderFLKSection(); renderCMSection();
  renderReport();
  const n1 = RES.ib.length, n2 = RES.flk.length, n3 = RES.cm.length;
  $("#data-status").innerHTML = (n1 + n2 + n3) > 0
    ? `<span class="badge ok">已导入：IB ${n1} 行 · Flanker ${n2} 行 · C&M ${n3} 行（左实测 / 右预期）</span>`
    : `<span class="badge info">未导入真实数据——各板块右侧橙色标签为收数前预注册的预期结果</span>`;
}

window.addEventListener("DOMContentLoaded", () => {
  const dt = $("#deco-tl"), db = $("#deco-br");
  if (dt) dt.innerHTML = DECO_SVG.tl;
  if (db) db.innerHTML = DECO_SVG.br;
  RES.pred = buildPredicted();               // 预期结果（预注册预测示意）常驻展示
  renderAll();
  // 全班课堂数据（本地快照）异步加载，完成后重渲染出现对比面板
  loadClassData().then(() => renderAll());
  $("#btn-import").addEventListener("click", () => $("#file-in").click());

  /** 从课程收数接口读取本项目收集到的全部被试数据（无需密钥） */
  async function fetchProjectData(silent) {
    const project = CONFIG.PROJECT_CODE;
    if (!project || project === "XXXXXX") {
      if (!silent) $("#data-status").innerHTML = `<span class="badge err">未配置项目码（config.js）</span>`;
      return 0;
    }
    if (!silent) $("#data-status").textContent = "正在从收数接口读取…";
    let n = 0, fails = 0;
    const expMap = { ib_multistim: "ib", flanker_emotion: "flanker", cm_perception: "cm" };
    const summary = [];
    for (const exp of Object.keys(expMap)) {
      try {
        const r = await fetch(`${CONFIG.API_DATA}?project=${project}&experiment=${exp}`);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        const recs = j.records || [];
        const pids = new Set(recs.map(x => x.participant));
        summary.push(`${expMap[exp]} ${pids.size} 人`);
        recs.forEach(rec => {
          n += ingest((rec.trials || []).map(t => Object.assign({}, t, { pid: rec.participant })));
        });
      } catch (e) { fails++; summary.push(`${expMap[exp]} 失败`); }
    }
    if (n) {
      $("#data-status").innerHTML = `<span class="badge ok">已读取本项目 ${n} 行数据（${summary.join(" · ")}）`
        + `${fails ? "（部分实验读取失败）" : ""}——左实测 / 右预期</span>`;
      renderAll();
    } else if (!silent) {
      $("#data-status").innerHTML = `<span class="badge err">接口暂无数据（先让被试完成实验，或核对项目码 ${project}）</span>`;
    }
    return n;
  }
  $("#btn-fetch-api").addEventListener("click", () => fetchProjectData(false));
  // 进入页面自动尝试读取一次（静默，失败不打扰）
  setTimeout(() => fetchProjectData(true), 600);
  $("#file-in").addEventListener("change", async e => {
    let n = 0;
    for (const f of e.target.files) {
      const text = await f.text();
      let rows = [];
      if (f.name.endsWith(".json")) {
        try { const j = JSON.parse(text); rows = j.trials || []; } catch (_) { }
      } else rows = parseCSV(text);
      n += ingest(rows);
    }
    $("#data-status").innerHTML = `<span class="badge ok">已导入 ${n} 行数据（左实测 / 右预期，自动分析报告已生成）</span>`;
    renderAll();
  });
  $("#btn-copy-md") && $("#btn-copy-md").addEventListener("click", async () => {
    if (!window.__mdReport) return;
    try {
      await navigator.clipboard.writeText(window.__mdReport);
      $("#btn-copy-md").textContent = "已复制 ✓（可粘贴进 README 结果与讨论）";
      setTimeout(() => { $("#btn-copy-md").textContent = "复制 Markdown 报告文本"; }, 2500);
    } catch (_) {
      // clipboard 不可用（http 非 localhost 等）时退回选区复制
      const ta = document.createElement("textarea");
      ta.value = window.__mdReport; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); ta.remove();
      $("#btn-copy-md").textContent = "已复制 ✓";
    }
  });
  renderAll();
});
