/* ============================================================
   exp_flanker.js —— 实验2：情绪侧翼 Flanker
   基线：Eriksen & Eriksen (1974) flanker 范式
   改进（2×2 被试内，全部试次随机混排）：
     侧翼情绪价效（愤怒 vs 中性面孔）× 一致性（侧翼箭头与目标同向 / 反向）
     → 检验愤怒干扰是否比中性干扰更难抑制（情绪注意偏向）
   素材：A*=愤怒面孔，N*=中性面孔（灰度化，视觉属性匹配）
   按键：F = 目标箭头朝左，J = 目标箭头朝右
   ============================================================ */
"use strict";

const FLK = {
  // 侧翼面孔：男性面孔（2 愤怒 + 2 中性），灰度呈现
  // 注意：文件名大小写必须与仓库完全一致（GitHub Pages/Linux 区分大小写）
  flankers: { angry: ["../stimuli/faces/AM8.BMP", "../stimuli/faces/AM17.bmp"],
              neutral: ["../stimuli/faces/NEM104.bmp", "../stimuli/faces/NEM109.bmp"] },
  perCell: 10,            // 每 (情绪×一致性×方向) 10 试次 → 80 正式
  practicePerCell: 4,     // 练习 16 试次
  W: 900, H: 300,
  FW: 130, FH: 150, GAP: 18,   // 面孔尺寸与间距
};

const FLK_STATE = {
  phase: "instr", trials: [], pracIdx: 0, formalIdx: 0, images: {},
  gray: {},               // 预渲染的灰度面孔画布（不依赖 ctx.filter，兼容所有浏览器）
  pracResults: [], pracRounds: 0,
};

function preloadImages(paths, cb) {
  let n = 0;
  paths.forEach(p => {
    const img = new Image();
    img.onload = () => {
      // 预渲染灰度版本（逐像素亮度加权），消除颜色等低级差异；
      // 不用 ctx.filter 是因为部分浏览器不支持，会导致愤怒/中性面孔颜色不匹配
      const c = document.createElement("canvas"); c.width = FLK.FW; c.height = FLK.FH;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, FLK.FW, FLK.FH);
      try {
        const d = g.getImageData(0, 0, FLK.FW, FLK.FH);
        for (let i = 0; i < d.data.length; i += 4) {
          const v = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
          d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        }
        g.putImageData(d, 0, 0);
      } catch (e) { /* canvas 被污染等异常时退回原图 */ }
      FLK_STATE.gray[p] = c;
      if (++n === paths.length) cb();
    };
    img.onerror = () => {
      // 大小写回退：Linux 服务器（如 GitHub Pages）区分大小写，先用全小写路径重试
      const lower = p.toLowerCase();
      if (lower !== p) img.src = lower;
      else alert("素材加载失败：" + p);
    };
    img.src = p; FLK_STATE.images[p] = img;
  });
}

/* ---------- 构建试次 ---------- */
/** 单试次：4 个侧翼位置交替使用池中两张面孔（身份均衡），侧翼携带方向箭头 */
function makeTrial(flankerEmo, congruent, targetDir, rnd) {
  const pool = FLK.flankers[flankerEmo];
  const rot = Math.floor(rnd() * 2);
  const fImgs = [0, 1, 0, 1].map(i => pool[(i + rot) % 2]);
  return {
    flankerEmo, congruent, targetDir, fImgs,
    flankerDir: congruent ? targetDir : -targetDir,
    cond: `${flankerEmo === "angry" ? "fa" : "fn"}_${congruent ? "c" : "i"}`,
    key: targetDir < 0 ? "f" : "j",
  };
}
function buildTrials(nPer, rnd) {
  const list = [];
  [["angry", 1], ["angry", 0], ["neutral", 1], ["neutral", 0]].forEach(([emo, cong]) => {
    [-1, 1].forEach(dir => {
      for (let i = 0; i < nPer; i++) list.push(makeTrial(emo, cong, dir, rnd));
    });
  });
  return shuffle(list, rnd);
}

/* ---------- 呈现 ---------- */
function flkStage() { return $("#stage"); }
function flkCanvas() { return $("#stage-canvas"); }

/** 箭头（dir: -1 朝左 / +1 朝右），白底深描边保证在任何背景上可见 */
function drawArrow(ctx, cx, cy, dir, w, h) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(dir, 1);
  const hw = h * 1.2;                       // 箭头头部宽度
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 6);
  ctx.lineTo(w / 2 - hw, -h / 6);
  ctx.lineTo(w / 2 - hw, -h / 2);
  ctx.lineTo(w / 2, 0);
  ctx.lineTo(w / 2 - hw, h / 2);
  ctx.lineTo(w / 2 - hw, h / 6);
  ctx.lineTo(-w / 2, h / 6);
  ctx.closePath();
  ctx.fillStyle = "#f5f6f7"; ctx.fill();
  ctx.strokeStyle = "#0d0d10"; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}

/** 刺激簇：[面孔+箭头][面孔+箭头] [目标箭头] [面孔+箭头][面孔+箭头] */
function drawFlanker(ctx, tr) {
  const g = FLK;
  ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, g.W, g.H);
  const totalW = 5 * g.FW + 4 * g.GAP;
  const x0 = (g.W - totalW) / 2, y0 = (g.H - g.FH) / 2;
  const order = [tr.fImgs[0], tr.fImgs[1], null, tr.fImgs[2], tr.fImgs[3]];
  order.forEach((img, i) => {
    const cx = x0 + i * (g.FW + g.GAP) + g.FW / 2, cy = y0 + g.FH / 2;
    if (img) {
      // 绘制预渲染的灰度面孔（消除颜色差异；不依赖 ctx.filter）
      ctx.drawImage(FLK_STATE.gray[img] || FLK_STATE.images[img], cx - g.FW / 2, y0, g.FW, g.FH);
      drawArrow(ctx, cx, cy, tr.flankerDir, 95, 34);   // 侧翼箭头叠画在面孔中央
    } else {
      drawArrow(ctx, cx, cy, tr.targetDir, 135, 50);  // 中央目标箭头（无面孔）
    }
  });
  return { x0, y0, totalW };               // 供眼动 ROI 分析
}

function drawFixation(ctx) {
  ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, FLK.W, FLK.H);
  ctx.fillStyle = "#d7dae0"; ctx.font = "42px Inter, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("+", FLK.W / 2, FLK.H / 2);
  ctx.textBaseline = "alphabetic";
}

let curTrial = null, curT0 = 0, curOnT = 0, responded = false, stimShown = false, deadlineTimer = null;

function runFlkTrial(tr) {
  curTrial = tr; responded = false; stimShown = false;   // 刺激未呈现期间忽略按键
  const ctx = flkCanvas().getContext("2d");
  drawFixation(ctx);
  setTimeout(() => {
    const geo = drawFlanker(ctx, tr);
    curTrial.geo = geo;
    stimShown = true;
    curOnT = curT0 = performance.now();
    deadlineTimer = setTimeout(() => { if (!responded) respond(null); }, 2500);
  }, 500);
}

function respond(key) {
  if (responded || !stimShown || !curTrial) return;   // 刺激呈现前的按键一律忽略（防崩+防脏数据）
  responded = true;
  clearTimeout(deadlineTimer);
  const rt = performance.now() - curT0;
  const offT = performance.now();
  const correct = key === curTrial.key ? 1 : 0;
  const gaze = GZ.enabled ? GZ.window(curOnT, offT) : [];
  // 眼动 ROI：侧翼区域（左右各两格）vs 中央目标区域
  let gazeF = null;
  if (gaze.length) {
    const r = flkCanvas().getBoundingClientRect();
    const sx = r.left, sy = r.top;
    const fL = gaze.filter(s => s.x > sx + curTrial.geo.x0 && s.x < sx + curTrial.geo.x0 + 2 * (FLK.FW + FLK.GAP) - FLK.GAP);
    const fR = gaze.filter(s => s.x > sx + curTrial.geo.x0 + 3 * (FLK.FW + FLK.GAP) && s.x < sx + curTrial.geo.x0 + curTrial.geo.totalW);
    const cT = gaze.filter(s => Math.abs(s.x - (sx + curTrial.geo.x0 + 2 * (FLK.FW + FLK.GAP) + FLK.FW / 2)) < FLK.FW / 2 + 30);
    gazeF = (fL.length + fR.length) / (fL.length + fR.length + cT.length || 1);
  }
  const rec = {
    cond: curTrial.cond, flankerEmo: curTrial.flankerEmo,
    congruent: curTrial.congruent ? 1 : 0,
    targetDir: curTrial.targetDir < 0 ? "left" : "right",
    rt: Math.round(rt), correct,
    timeout: key === null ? 1 : 0,
    gazeFlankerRatio: gazeF === null ? null : +gazeF.toFixed(3),
    gazeN: gaze.length, gazeSrc: GZ.source, phase: FLK_STATE.phase,
  };
  if (FLK_STATE.phase === "practice") FLK_STATE.pracResults.push(rec);
  else Collector.push(rec);
  // 极淡文字反馈（按键后立即清除刺激）
  const ctx = flkCanvas().getContext("2d");
  ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, FLK.W, FLK.H);
  ctx.fillStyle = "#55555c"; ctx.font = "24px Inter, 'Microsoft YaHei', sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(key === null ? "未作答" : (correct ? "正确" : "错误"), FLK.W / 2, FLK.H / 2);
  ctx.textBaseline = "alphabetic";
  setTimeout(nextFlk, 500);   // ITI
}

function nextFlk() {
  const S = FLK_STATE;
  if (S.phase === "practice") {
    if (S.pracIdx < S.practice.length) {
      Progress.set(S.pracIdx / S.practice.length, `练习试次 ${S.pracIdx + 1}/${S.practice.length}`);
      runFlkTrial(S.practice[S.pracIdx++]);
    } else flkPracticeDone();
  } else if (S.phase === "formal") {
    if (S.formalIdx < S.trials.length) {
      Progress.set(S.formalIdx / S.trials.length, `正式试次 ${S.formalIdx + 1}/${S.trials.length}`);
      runFlkTrial(S.trials[S.formalIdx++]);
    } else flkFinish();
  }
}

/* ---------- 练习达标检验（<80% 重复练习，最多 3 轮） ---------- */
function flkPracticeDone() {
  const S = FLK_STATE;
  const acc = S.pracResults.length ? mean(S.pracResults.map(r => r.correct)) : 0;
  S.pracRounds++;
  flkStage().classList.remove("on");
  $("#app").style.display = "block";
  const pass = acc >= 0.8 || S.pracRounds >= 3;
  $("#app").innerHTML = `
  <div class="card fade">
    <h1>练习试次已完成</h1>
    <div class="steps"><div class="step done">知情同意</div><div class="step done">指导语</div><div class="step done">练习</div><div class="step on">正式实验</div><div class="step">结束</div></div>
    <div class="callout ${pass ? "" : "warn"}"><b>练习正确率 ${(acc * 100).toFixed(0)}%</b><br>
      ${pass
        ? "练习试次结束，请点击下方按钮进入正式实验。正式实验流程与练习完全相同：判断<b>中间箭头</b>的方向，<code class=\"kbd\">F</code> = 朝左，<code class=\"kbd\">J</code> = 朝右。请又快又准地作答。"
        : "正确率尚未达到 80%。建议再练习一轮（最多 3 轮），熟悉按键规则：<code class=\"kbd\">F</code> = 中间箭头朝左，<code class=\"kbd\">J</code> = 朝右。"}</div>
    <div class="btn-row">
      ${pass ? `<button class="btn" id="btn-formal">进入正式实验</button>`
             : `<button class="btn" id="btn-reprac">再练习一轮</button>
                <button class="btn gray" id="btn-formal">直接进入正式实验</button>`}
    </div>
  </div>`;
  const go = () => {
    $("#app").style.display = "none";
    flkStage().classList.add("on");
    startFlkFormal();
  };
  const b1 = $("#btn-formal"); if (b1) b1.addEventListener("click", go);
  const b2 = $("#btn-reprac"); if (b2) b2.addEventListener("click", () => {
    $("#app").style.display = "none";
    flkStage().classList.add("on");
    startFlkPractice();
  });
}

function startFlkPractice() {
  const S = FLK_STATE;
  S.phase = "practice";
  S.practice = buildTrials(FLK.practicePerCell / 2, RNG(42 + S.pracRounds));
  S.pracIdx = 0; S.pracResults = [];
  $("#stage-hint").textContent = "练习阶段：F = 箭头朝左，J = 箭头朝右";
  nextFlk();
}

function startFlkFormal() {
  FLK_STATE.phase = "formal";
  const seed = [...Session.pid].reduce((s, c) => s * 31 + c.charCodeAt(0), 13) >>> 0;
  FLK_STATE.trials = buildTrials(FLK.perCell, RNG(seed));
  FLK_STATE.formalIdx = 0;
  Collector.begin("flanker_emotion", "flanker_valence_x_congruency");
  $("#stage-hint").textContent = "正式实验：只判断中间箭头的方向（F=左 J=右）";
  Progress.show();
  nextFlk();
}

async function flkFinish() {
  flkStage().classList.remove("on");
  Progress.set(1, "完成");
  const sub = await Collector.submit();
  GZ.stop();
  const t = Collector.trials;
  const acc = mean(t.map(x => x.correct));
  const rtOk = t.filter(x => x.correct);
  const cell = (emo, cong) => rtOk.filter(x => x.flankerEmo === emo && x.congruent === cong).map(x => x.rt);
  const m = a => a.length ? Math.round(mean(a)) : 0;
  const cost = (emo) => m(cell(emo, 0)) - m(cell(emo, 1));   // 不一致 − 一致
  $("#app").style.display = "block";
  $("#app").innerHTML = `
  <div class="card fade">
    <h1>实验完成，感谢参与！</h1>
    <p>被试编号 <b>${Session.pid}</b> · 正确率 <b>${(acc * 100).toFixed(1)}%</b> ·
       数据上传：<b class="${sub.ok ? "badge ok" : "badge err"}">${sub.ok ? ("成功" + (sub.warnings ? "（服务器清洗提示：" + (Array.isArray(sub.warnings) ? sub.warnings.join("；") : sub.warnings) + "）" : "")) : "失败（" + (sub.reason || sub.status) + "）"}</b></p>
    <div class="chart-box"><h3>你的四条件平均反应时（正确试次，ms）</h3>
      <table class="table">
        <tr><th>条件</th><th>含义</th><th>RT</th></tr>
        <tr><td>中性 · 一致</td><td>中性侧翼，箭头同向</td><td>${m(cell("neutral", 1))}</td></tr>
        <tr><td>中性 · 不一致</td><td>中性侧翼，箭头反向</td><td>${m(cell("neutral", 0))}</td></tr>
        <tr><td>愤怒 · 一致</td><td>愤怒侧翼，箭头同向</td><td>${m(cell("angry", 1))}</td></tr>
        <tr><td>愤怒 · 不一致</td><td>愤怒侧翼，箭头反向</td><td>${m(cell("angry", 0))}</td></tr>
      </table>
      <p class="muted">你的情绪干扰量 = 愤怒侧翼冲突 − 中性侧翼冲突 = ${cost("angry") - cost("neutral")} ms。
      完整分析与「冷注意 vs 情绪捕获」模型对比见 <a href="../results.html">结果页</a>。</p>
    </div>
    <div id="my-result"></div>
    <div class="btn-row">
      <button class="btn ghost" onclick="Collector.exportCSV()">导出 CSV（上传失败时用）</button>
      <a class="btn gray" href="../index.html">返回首页</a>
    </div>
  </div>`;
  renderMyResult("flanker", t);
}

/* ---------- 启动 ---------- */
window.addEventListener("DOMContentLoaded", () => {
  $("#app").innerHTML = buildConsentFlow("情绪侧翼 Flanker —— 干扰项的情绪价效", `
      屏幕中央会出现一个<b>箭头</b>，两侧各有两张携带箭头的<b>面孔</b>。
      你只需要判断<b>中间箭头的方向</b>并按键作答。`);
  bindConsentFlow(() => {
    $("#app").innerHTML = `
    <div class="card fade">
      <h1>指导语</h1>
      <div class="steps"><div class="step on">知情同意</div><div class="step on">指导语</div><div class="step">练习</div><div class="step">正式实验</div><div class="step">结束</div></div>
      <p>每一试次屏幕上会水平排布一行刺激：</p>
      <ul class="tight">
        <li><b>中间</b>是一个白色箭头（目标）；</li>
        <li>左右两侧各两张<b>面孔</b>，面孔上也叠有箭头（干扰项）；</li>
        <li>只判断<b>中间箭头</b>的方向：<code class="kbd">F</code> = 朝左，<code class="kbd">J</code> = 朝右。</li>
      </ul>
      <div class="callout"><b>要求</b>：忽略两侧面孔，又快又准。请在 2.5 秒内作答，超时记为错误。</div>
      <div class="callout warn"><b>注意</b>：请将双手食指放在 F 和 J 键上，全程保持注视屏幕中央的「+」，不要刻意去看两侧面孔。</div>
      <p class="muted">先完成练习试次（正确率达标后进入正式实验），熟悉后进入 80 个正式试次。</p>
      <div class="btn-row"><button class="btn" id="btn-practice" disabled>开始练习（加载素材…）</button></div>
    </div>`;
    const allImgs = [...FLK.flankers.angry, ...FLK.flankers.neutral];
    preloadImages(allImgs, () => { const b = $("#btn-practice"); b.textContent = "开始练习"; b.disabled = false; });
    $("#btn-practice").addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `
      <div class="stage" id="stage">
        <canvas id="stage-canvas" width="${FLK.W}" height="${FLK.H}"></canvas>
        <div class="hint" id="stage-hint">练习阶段：F = 箭头朝左，J = 箭头朝右</div>
      </div>`);
      flkStage().classList.add("on");
      $("#app").style.display = "none";
      document.addEventListener("keydown", e => {
        if (!["f", "j", "F", "J"].includes(e.key)) return;
        respond(e.key.toLowerCase());
      });
      startFlkPractice();
    });
  });
});
