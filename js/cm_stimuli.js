/* ============================================================
   cm_stimuli.js —— Cleveland & McGill 刺激定义与绘制（部分-整体比例版）
   · buildCMTrials()：48 个正式试次（4 编码 × 4 比例 × 3 时长）
   · buildAICharts()：16 张唯一图形（4 编码 × 4 比例），供离线 AI 预跑
   · drawChart()：在 canvas 上按统一几何规范绘制
   四类编码均为「部分 / 整体」结构，答案统一 = ratio × 100（百分比）：
     position：水平标尺，蓝色从左端填充到标记刻度（估蓝占全长 %）
     length  ：蓝短 / 灰长两条线段（估蓝是灰的 %）
     angle   ：整圆中蓝色扇区从 12 点顺时针展开（sweep = ratio × 360°）
     area    ：同心圆，蓝色小圆半径 = R × √ratio（面积比 = ratio）
   注意：本文件同时被实验页面与 AI 刺激导出（tools/render_ai_stimuli.ps1）
        引用，几何参数不可随意改动，否则人类与 AI 看到的刺激将不一致。
   ============================================================ */
"use strict";

/* 编码类型：position(位置) / length(长度) / angle(角度) / area(面积) */
const CM_ENCODINGS = ["position", "length", "angle", "area"];
const CM_RATIOS = [0.25, 0.40, 0.60, 0.75];          // 蓝色部分 / 整体
const CM_DURATIONS = [500, 2000, Infinity];          // 呈现时长（ms），Infinity = 无限
const CM_ENC_CN = { position: "位置", length: "长度", angle: "角度", area: "面积" };

/* 分编码作答问题（答案均为蓝色 / 整体的百分比） */
const CM_Q = {
  position: "蓝色线段（从左端到标记刻度）占整条标尺长度的百分之多少？",
  length: "蓝色线段的长度是灰色线段的百分之多少？",
  angle: "蓝色扇区占整个圆形的百分之多少？",
  area: "蓝色圆形的面积是灰色圆形面积的百分之多少？",
};

/* 统一几何规范（画布 800×420，与 AI 导出完全一致） */
const CM_GEO = {
  W: 800, H: 420,
  ruler: { x0: 100, x1: 700, y: 210, h: 18 },        // position 标尺
  seg:   { x: 160, L: 480, yTop: 150, yBot: 270, th: 18 }, // length 双线段
  pie:   { cx: 400, cy: 210, r: 150 },               // angle 整圆
  area:  { cx: 400, cy: 210, R: 130 },               // area 同心圆
  cSmall: "#2563eb",   // 蓝色（待估计部分）
  cLarge: "#cbd5e1",   // 灰色（整体 / 参照）
  cStroke: "#475569",
};

/** 96 试次固定列表：每个 (编码×比例) 在三种时长下各呈现 **2 次**（保证每格 ≥10 试次：
 *  每 编码×时长 格 8 试次/人、每编码 24 试次/人；≥5 名被试合并后每格 ≥40 试次）。
 * 第 2 遍重复时 side 翻转（length 编码蓝条上下位置互换，实现位置平衡）；side 仅 length 用 */
function buildCMTrials() {
  const trials = []; let k = 0;
  CM_ENCODINGS.forEach((enc, ei) =>
    CM_RATIOS.forEach((ratio, ri) => {
      const side = (ei + ri) % 2;
      for (const dur of CM_DURATIONS)
        trials.push({ idx: k++, enc, ratio, dur, side });
      for (const dur of CM_DURATIONS)
        trials.push({ idx: k++, enc, ratio, dur, side: 1 - side });
    }));
  return trials;
}

/** 16 张唯一图形（人类与 AI 对决用） */
function buildAICharts() {
  const charts = [];
  CM_ENCODINGS.forEach((enc, ei) =>
    CM_RATIOS.forEach((ratio, ri) => {
      charts.push({ id: "C" + String(charts.length + 1).padStart(2, "0"), enc, ratio, side: (ei + ri) % 2 });
    }));
  return charts;
}

/**
 * 在 canvas 2d 上下文绘制一个编码图形
 * @param chart {enc, ratio, side}
 */
function drawChart(ctx, chart) {
  const g = CM_GEO;
  ctx.clearRect(0, 0, g.W, g.H);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, g.W, g.H);
  const { enc, ratio, side } = chart;

  if (enc === "position") {
    // 水平标尺：灰色全长 + 蓝色从左端填充到标记刻度
    const xm = g.ruler.x0 + ratio * (g.ruler.x1 - g.ruler.x0);
    ctx.fillStyle = g.cLarge;
    ctx.fillRect(g.ruler.x0, g.ruler.y - g.ruler.h / 2, g.ruler.x1 - g.ruler.x0, g.ruler.h);
    ctx.fillStyle = g.cSmall;
    ctx.fillRect(g.ruler.x0, g.ruler.y - g.ruler.h / 2, xm - g.ruler.x0, g.ruler.h);
    // 两端与标记刻度
    ctx.strokeStyle = g.cStroke; ctx.lineWidth = 3;
    [g.ruler.x0, g.ruler.x1].forEach(x => {
      ctx.beginPath(); ctx.moveTo(x, g.ruler.y - 26); ctx.lineTo(x, g.ruler.y + 26); ctx.stroke();
    });
    ctx.beginPath(); ctx.moveTo(xm, g.ruler.y - 34); ctx.lineTo(xm, g.ruler.y + 34); ctx.stroke();
  } else if (enc === "length") {
    // 两条并排水平线段（圆头）：灰色全长 L，蓝色 ratio × L；side 决定上下位置
    const yS = side === 0 ? g.seg.yTop : g.seg.yBot;   // 蓝色
    const yL = side === 0 ? g.seg.yBot : g.seg.yTop;   // 灰色
    ctx.lineCap = "round"; ctx.lineWidth = g.seg.th;
    ctx.strokeStyle = g.cLarge;
    ctx.beginPath(); ctx.moveTo(g.seg.x + g.seg.th / 2, yL); ctx.lineTo(g.seg.x + g.seg.L - g.seg.th / 2, yL); ctx.stroke();
    ctx.strokeStyle = g.cSmall;
    ctx.beginPath(); ctx.moveTo(g.seg.x + g.seg.th / 2, yS); ctx.lineTo(g.seg.x + g.seg.th / 2 + ratio * (g.seg.L - g.seg.th), yS); ctx.stroke();
    ctx.lineCap = "butt";
  } else if (enc === "angle") {
    // 整圆：灰色满圆 + 蓝色扇区从 12 点顺时针展开 sweep = ratio × 360°
    const start = -Math.PI / 2, sweep = ratio * Math.PI * 2;
    ctx.fillStyle = g.cLarge;
    ctx.beginPath(); ctx.arc(g.pie.cx, g.pie.cy, g.pie.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g.cSmall;
    ctx.beginPath();
    ctx.moveTo(g.pie.cx, g.pie.cy);
    ctx.arc(g.pie.cx, g.pie.cy, g.pie.r, start, start + sweep);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = g.cStroke; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.pie.cx, g.pie.cy, g.pie.r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(g.pie.cx, g.pie.cy); ctx.lineTo(g.pie.cx, g.pie.cy - g.pie.r); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(g.pie.cx, g.pie.cy);
    ctx.lineTo(g.pie.cx + g.pie.r * Math.cos(start + sweep), g.pie.cy + g.pie.r * Math.sin(start + sweep));
    ctx.stroke();
  } else if (enc === "area") {
    // 同心圆：灰色大圆 R + 蓝色小圆 r = R × √ratio（面积比 = ratio）
    const rS = g.area.R * Math.sqrt(ratio);
    ctx.fillStyle = g.cLarge;
    ctx.beginPath(); ctx.arc(g.area.cx, g.area.cy, g.area.R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g.cSmall;
    ctx.beginPath(); ctx.arc(g.area.cx, g.area.cy, rS, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = g.cStroke; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.area.cx, g.area.cy, g.area.R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(g.area.cx, g.area.cy, rS, 0, Math.PI * 2); ctx.stroke();
  }
}

/** 随机噪点掩蔽（防止短时呈现后在心理表象中继续加工） */
function drawMask(ctx) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 110 + Math.floor(Math.random() * 110);
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** C&M 1984 式对数误差（以 2 为底），另附绝对百分比误差 */
function cmErrors(estimatePct, trueRatio) {
  const est = clamp(estimatePct / 100, 0.01, 10);
  const tru = clamp(trueRatio, 0.01, 10);
  return {
    log2err: Math.abs(Math.log2(est / tru)),
    absErr: Math.abs(estimatePct - trueRatio * 100),
  };
}
