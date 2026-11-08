/* ============================================================
   exp_cm.js —— 实验3：Cleveland & McGill 图形比例知觉
   设计：4 编码（位置/长度/角度/面积）× 3 呈现时长（500ms/2s/无限）
         × 4 比例（.25/.40/.60/.75），被试内设计，48 正式试次
   改进：呈现时长压力 → 检验编码层级是「自动知觉」还是「策略计算」；
         短时/中时条件到点后立即随机噪点掩蔽；
         滑块（0–100%）作答；离线 AI 同题作答 → 人机对比面板
   ============================================================ */
"use strict";

const EXP = {
  name: "C&M 图形知觉（复现+改进）",
  key: "cm",
  trials: [],
  pracIdx: 0, formalIdx: 0,
  phase: "instr",
};

/* ---------- 页面元素 ---------- */
function stageEl() { return $("#stage"); }
function canvasEl() { return $("#stage-canvas"); }
function inputRowEl() { return $("#resp-row"); }
function sliderEl() { return $("#resp-slider"); }
function sliderValEl() { return $("#resp-slider-val"); }

function setupStage() {
  document.body.insertAdjacentHTML("beforeend", `
  <div class="stage light" id="stage">
    <canvas id="stage-canvas" width="800" height="420"></canvas>
    <div id="fixation" class="fixation" style="color:#333;display:none;position:absolute">+</div>
    <div id="resp-row" style="display:none;margin-top:24px;flex-direction:column;align-items:center;gap:10px">
      <div id="resp-q" style="font-size:16.5px;color:#2b2f36;max-width:660px;text-align:center;font-weight:600"></div>
      <div style="display:flex;align-items:center;gap:16px">
        <span style="font-size:15px;color:#6b7280">0%</span>
        <input id="resp-slider" type="range" min="0" max="100" step="1" value="50"
               style="width:340px;accent-color:#2563eb;cursor:pointer">
        <span style="font-size:15px;color:#6b7280">100%</span>
      </div>
      <div style="font-size:32px;font-weight:700;color:#2563eb" id="resp-slider-val">50%</div>
      <button class="btn small" id="resp-go">确认作答 (Enter)</button>
    </div>
    <div class="hint" id="stage-hint"></div>
  </div>`);
  sliderEl().addEventListener("input", () => sliderValEl().textContent = sliderEl().value + "%");
  sliderEl().addEventListener("keydown", e => { if (e.key === "Enter") submitResponse(); });
  $("#resp-go").addEventListener("click", submitResponse);
}

/* ---------- 试次运行 ---------- */
let curCMTrial = null, curCMT0 = 0, curCMOnT = 0, curCMOffT = 0, awaiting = false, gazeWin = [];

function runTrial(trial) {
  curCMTrial = trial; awaiting = true;
  const ctx = canvasEl().getContext("2d");
  inputRowEl().style.display = "none";
  sliderEl().value = 50; sliderValEl().textContent = "50%";
  $("#resp-q").innerHTML = CM_Q[trial.enc];   // 分编码提问
  // 注视点 600ms
  canvasEl().style.visibility = "hidden";
  $("#fixation").style.display = "block";
  setTimeout(() => {
    $("#fixation").style.display = "none";
    // 呈现刺激
    drawChart(ctx, trial);
    canvasEl().style.visibility = "visible";
    curCMOnT = performance.now();
    if (trial.dur === Infinity) {
      // 无限时：刺激与滑块同屏，确认后刺激才消失
      curCMT0 = curCMOnT;
      inputRowEl().style.display = "flex";
      sliderEl().focus();
    } else {
      // 短时/中时：到点立即随机噪点掩蔽 300ms，再出现滑块
      setTimeout(() => {
        curCMOffT = performance.now();
        gazeWin = GZ.enabled ? GZ.window(curCMOnT, curCMOffT) : [];
        drawMask(ctx);
        setTimeout(() => {
          canvasEl().style.visibility = "hidden";
          curCMT0 = performance.now();
          inputRowEl().style.display = "flex";
          sliderEl().focus();
        }, 300);
      }, trial.dur);
    }
  }, 600);
}

function submitResponse() {
  if (!awaiting) return;
  awaiting = false;
  const v = +sliderEl().value;
  const rt = performance.now() - curCMT0;
  if (curCMTrial.dur === Infinity) {
    curCMOffT = performance.now();
    gazeWin = GZ.enabled ? GZ.window(curCMOnT, curCMOffT) : [];
  }
  const errs = cmErrors(v, curCMTrial.ratio);
  // 仅正式试次进入收数（练习试次不上传、不导出，避免与正式数据混淆）
  if (EXP.phase === "formal") {
    Collector.push({
      cond: `${curCMTrial.enc}_${curCMTrial.dur === Infinity ? "free" : curCMTrial.dur}`,
      enc: curCMTrial.enc, durMs: curCMTrial.dur === Infinity ? -1 : curCMTrial.dur,
      ratio: curCMTrial.ratio, side: curCMTrial.side,
      est: v, truePct: +(curCMTrial.ratio * 100).toFixed(0),
      log2err: +errs.log2err.toFixed(4), absErr: +errs.absErr.toFixed(2),
      rt: Math.round(rt),
      gazeN: gazeWin.length, gazeSrc: GZ.source,
      phase: EXP.phase,
    });
  }
  inputRowEl().style.display = "none";
  next();
}

/* ---------- 流程控制 ---------- */
function next() {
  if (EXP.phase === "practice") {
    if (EXP.pracIdx < EXP.practice.length) {
      Progress.set(EXP.pracIdx / EXP.practice.length, `练习试次 ${EXP.pracIdx + 1}/${EXP.practice.length}`);
      runTrial(EXP.practice[EXP.pracIdx++]);
    } else { cmTransition(); }
  } else if (EXP.phase === "formal") {
    if (EXP.formalIdx < EXP.trials.length) {
      Progress.set(EXP.formalIdx / EXP.trials.length, `正式试次 ${EXP.formalIdx + 1}/${EXP.trials.length}`);
      runTrial(EXP.trials[EXP.formalIdx++]);
    } else { finish(); }
  }
}

/* 练习 → 正式过渡页（明确区分练习与正式试次） */
function cmTransition() {
  EXP.phase = "transition";
  stageEl().classList.remove("on");
  $("#app").style.display = "block";
  $("#app").innerHTML = `
  <div class="card fade">
    <h1>练习试次已完成</h1>
    <div class="steps"><div class="step done">知情同意</div><div class="step done">指导语</div><div class="step done">练习</div><div class="step on">正式实验</div><div class="step">结束</div></div>
    <div class="callout"><b>练习试次结束，请点击下方按钮进入正式实验</b><br>
      正式实验共 <b>96 个试次</b>（约 12 分钟），流程与练习相同，但<b>部分图形只会短暂呈现</b>
      （0.5 秒或 2 秒后被噪点掩蔽），请凭第一印象作答。作答本身不限时。</div>
    <div class="btn-row"><button class="btn" id="btn-formal">进入正式实验</button></div>
  </div>`;
  $("#btn-formal").addEventListener("click", () => {
    $("#app").style.display = "none";
    startFormal();
  });
}

function startFormal() {
  EXP.phase = "formal";
  stageEl().classList.add("on");
  $("#app").style.display = "none";
  // 每名被试独立随机呈现顺序（种子取被试号哈希）
  const seed = [...Session.pid].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
  EXP.trials = shuffle(buildCMTrials(), RNG(seed));
  EXP.formalIdx = 0;
  Collector.begin("cm_perception", "cm_duration_x_encoding");   // 收数从正式试次开始
  $("#stage-hint").textContent = "";
  next();
}

async function finish() {
  stageEl().classList.remove("on");
  Progress.set(1, "完成");
  const sub = await Collector.submit();
  GZ.stop();
  const byEnc = {};
  Collector.trials.forEach(t => { (byEnc[t.enc] = byEnc[t.enc] || []).push(t.log2err); });
  const encRows = CM_ENCODINGS.map(e =>
    `<tr><td>${CM_ENC_CN[e]}</td><td>${(byEnc[e] ? mean(byEnc[e]) : 0).toFixed(3)}</td><td>${byEnc[e] ? byEnc[e].length : 0}</td></tr>`).join("");
  $("#app").style.display = "block";
  $("#app").innerHTML = `
  <div class="card fade">
    <h1>实验完成，感谢参与！</h1>
    <p>被试编号 <b>${Session.pid}</b> · 有效试次 <b>${Collector.trials.length}</b> ·
       数据上传：<b class="${sub.ok ? "badge ok" : "badge err"}">${sub.ok ? ("成功" + (sub.warnings ? "（服务器清洗提示：" + (Array.isArray(sub.warnings) ? sub.warnings.join("；") : sub.warnings) + "）" : "")) : "失败（" + (sub.reason || sub.status) + "）"}</b></p>
    ${sub.ok ? "" : `<p class="muted">上传失败时请点击下方导出 CSV，发给实验者即可。</p>`}
    <div id="my-result"></div>
    <div class="chart-box"><h3>你的各编码平均对数误差（越小越准）</h3>
      <table class="table"><tr><th>编码</th><th>log₂ 误差</th><th>试次数</th></tr>${encRows}</table>
      <p class="muted">完整分析（含编码×时长交互检验、与 C&M 1984 及多模态大模型对比）见
      <a href="../results.html">结果与模型可视化</a> 页面。</p>
    </div>
    <div class="btn-row">
      <button class="btn ghost" onclick="Collector.exportCSV()">导出 CSV（上传失败时用）</button>
      <a class="btn gray" href="../index.html">返回首页</a>
    </div>
  </div>`;
  renderMyResult("cm", Collector.trials);
}

/* ---------- 启动 ---------- */
window.addEventListener("DOMContentLoaded", () => {
  $("#app").innerHTML = buildConsentFlow("图形比例知觉 —— 呈现时长与编码类型", `
      任务中你将看到不同类型的几何图形，请估计图中<b>蓝色部分所占的比例</b>（0–100%），
      用滑块作答。部分图形只会短暂呈现。`);
  bindConsentFlow(() => {
    // 指导语
    $("#app").innerHTML = `
    <div class="card fade">
      <h1>指导语</h1>
      <div class="steps"><div class="step on">知情同意</div><div class="step on">指导语</div><div class="step">练习</div><div class="step">正式实验</div><div class="step">结束</div></div>
      <p>屏幕上会呈现四种几何图形，你需要估计<b>蓝色部分</b>所占的比例：</p>
      <ul class="tight">
        <li><b>位置</b>：一条标尺，蓝色从左端填充到某处刻度；</li>
        <li><b>长度</b>：两条线段，蓝色较短、灰色较长；</li>
        <li><b>角度</b>：一个圆，蓝色扇区从 12 点方向展开；</li>
        <li><b>面积</b>：两个同心圆，蓝色在内、灰色在外。</li>
      </ul>
      <div class="callout"><b>你的任务</b>：按题目提示估计蓝色部分占整体（或占灰色参照）的
      <b>百分之多少</b>，拖动滑块选择 0–100% 后按确认。不同试次的提问会随图形类型变化，请注意阅读。</div>
      <div class="callout warn"><b>注意</b>：部分试次图形只闪现 <b>0.5 秒</b>或 <b>2 秒</b>就会被噪点掩蔽，
      请凭第一印象尽快形成估计；作答本身不限时。请基于图形本身估计，不要使用任何工具或计算。</div>
      <p class="muted">先完成 8 个练习试次（含短时呈现），熟悉后进入 96 个正式试次。请保持头部位置相对稳定。</p>
      <div class="btn-row">
        <button class="btn" id="btn-practice">开始练习</button>
      </div>
    </div>`;
    $("#btn-practice").addEventListener("click", () => {
      setupStage();
      EXP.phase = "practice";
      // 练习：4 编码 × {500ms, 无限}，顺序固定（先不限时再短时，便于熟悉滑块）
      EXP.practice = CM_ENCODINGS.flatMap(enc => [{ enc, ratio: 0.5, dur: Infinity, side: 0 }, { enc, ratio: 0.5, dur: 500, side: 1 }]);
      stageEl().classList.add("on");
      $("#app").style.display = "none";
      $("#stage-hint").textContent = "练习阶段：先看清图形，再用滑块作答";
      next();
    });
  });
});
