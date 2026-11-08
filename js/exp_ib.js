/* ============================================================
   exp_ib.js —— 实验1：专注计数与非注意盲（IB）· 被试内改进版
   基线：Simons & Chabris (1999) 传球计数范式（MOT）
   改进（被试内设计，每名被试 6 个关键轮次，每轮都出现意外刺激）：
     · 形象（3 水平）：白色雨伞 / 手持金币的鹅 / 胸口戴枫叶徽章的鹅
       ——鹅形刺激与被注意球员同类别（注意定势/相似性假设，Most et al., 2005）
     · 运动速度（3 水平）：快速 400 px/s / 慢速 110 px/s / 原地静止 4 s
       ——检验「运动速度而非静态显著性打破非注意盲」(Wood & Simons, 2023)
     · 运动方向（4 向 + 静止）：左→右 / 右→左 / 上→下 / 下→上
     · 传球速度每轮独立随机（两队也互不相同），轮次间不可预测
     平衡：每形象 2 次、每速度 2 次、同一形象两次速度不同、同形象不相邻
   迫选（察觉者）：身份（雨伞/鹅/皮球/小鸟 4 选 1）→ 鹅特征（4 选 1）
                  + 区域（4 选 1）+ 运动方向（5 选 1）
   眼动：事件窗口内注视与刺激轨迹的「注视接触率」（看了 ≠ 看见）
   ============================================================ */
"use strict";

const IB = {
  W: 900, H: 600,
  sprites: {
    sheriff: "../stimuli/players/sheriff.png",
    witch:   "../stimuli/players/witch.png",
    coin:    "../stimuli/players/coin_goose.png",    // 意外刺激：手持金币的鹅
    maple:   "../stimuli/players/maple_goose.png",   // 意外刺激：胸口戴枫叶徽章的鹅
  },
  playerTeams: ["sheriff", "witch"],
  spriteH: 116,                 // 球员精灵高度（2×，角色清晰可辨）
  stimH: 116,                   // 意外刺激（鹅形象）与球员同尺寸
  colors: {
    ballSheriff: "#fb923c", ballSheriffStroke: "#9a3412",   // 警长队球：橙色
    ballWitch: "#8b5cf6", ballWitchStroke: "#4c1d95",       // 巫医队球：紫色
    umb: "#f8fafc", umbStroke: "#334155", umbHandle: "#8d5524", // 白色雨伞（绿底高对比）
  },
  teamCN: { sheriff: "警长队", witch: "巫医队" },
  segDur: 15000,                // 每段 15 s
  nPerTeam: 4,
  speeds: { fast: 400, slow: 110, static: 0 },   // px/s
  identities: ["umb", "coin", "maple"],
  stimCN: { umb: "白色雨伞", coin: "手持金币的鹅", maple: "胸口戴枫叶徽章的鹅" },
  speedCN: { fast: "快速运动", slow: "慢速运动", static: "原地静止" },
  // —— 迫选题库（正确答案按每轮实际刺激与轨迹计算）——
  fcIdOptions: ["雨伞", "一只鹅", "一个皮球", "一只小鸟"],        // 身份（正确 = 雨伞 / 一只鹅）
  fcFeatOptions: ["手持一堆金币", "胸口有红色枫叶徽章", "抱着一个皮球", "头戴小草帽"],  // 鹅特征
  fcQuads: ["左上", "右上", "左下", "右下"],
  fcDirOptions: ["从左向右横穿", "从右向左横穿", "从上向下竖穿", "从下向上竖穿", "原地基本不动"],
  dirCN: { L: "从左向右横穿", R: "从右向左横穿", T: "从上向下竖穿", B: "从下向上竖穿", S: "原地基本不动" },
};

const IB_STATE = { schedule: null, segIdx: 0, raf: null, images: {}, lawn: null, pidHash: 0 };

/* ---------- 每名被试的 6 轮计划（形象 × 速度 平衡 + 方向/传球速度随机） ---------- */
function buildSchedule(rnd) {
  const ids = shuffle(IB.identities, rnd);
  // 三个「速度对」覆盖全部三种速度且各出现 2 次；同一形象两次速度必不同
  const pairs = shuffle([["fast", "slow"], ["fast", "static"], ["slow", "static"]], rnd);
  const list = [];
  ids.forEach((id, i) => list.push({ stim: id, speed: pairs[i][0] }, { stim: id, speed: pairs[i][1] }));
  // 重洗直至同一形象不出现在相邻轮次（减少「刚看过→刻意找」的预期；计数平衡始终满足）
  let sched = null;
  for (let attempt = 0; attempt < 24 && !sched; attempt++) {
    const cand = shuffle(list, rnd);
    if (cand.every((t, i) => i === 0 || t.stim !== cand[i - 1].stim)) sched = cand;
  }
  if (!sched) sched = shuffle(list, rnd);   // 极罕见兜底（仅相邻性可能不满足，平衡不受影响）
  sched.forEach(t => {
    t.dir = t.speed === "static" ? "S" : ["L", "R", "T", "B"][Math.floor(rnd() * 4)];
    t.spawnAt = 3000 + Math.floor(rnd() * 4000);          // 段内第 3–7 s 出现
    t.passVS = Math.round((300 + rnd() * 180) * 1.25);    // 本轮警长队传球球速 375–600 px/s（1.25×）
    t.passVW = Math.round((300 + rnd() * 180) * 1.25);    // 本轮巫医队传球球速（与警长队独立）
  });
  return sched;
}

/* ---------- 立体仿真草坪（一次性烘焙到离屏画布，逐帧仅 drawImage，不占主线程） ---------- */
function makeLawn() {
  const c = document.createElement("canvas"); c.width = IB.W; c.height = IB.H;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, IB.H);
  grad.addColorStop(0, "#7cb342"); grad.addColorStop(1, "#4e8329");
  g.fillStyle = grad; g.fillRect(0, 0, IB.W, IB.H);
  // 修剪条纹（横向明暗带，营造草坪纵深）
  const bands = 9;
  for (let i = 0; i < bands; i += 2) {
    g.fillStyle = "rgba(255,255,255,.06)";
    g.fillRect(0, i * IB.H / bands, IB.W, IB.H / bands);
  }
  // 静态草叶杂色（烘焙，不逐帧计算）
  const rnd = RNG(20241105);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = rnd() < .5 ? "rgba(255,255,240,.05)" : "rgba(20,60,10,.05)";
    g.fillRect(rnd() * IB.W, rnd() * IB.H, 2, 3);
  }
  // 场地白色边线 + 边缘暗角（立体感）
  g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 5;
  g.strokeRect(14, 14, IB.W - 28, IB.H - 28);
  const vg = g.createRadialGradient(IB.W / 2, IB.H / 2, IB.H * .32, IB.W / 2, IB.H / 2, IB.H * .85);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.20)");
  g.fillStyle = vg; g.fillRect(0, 0, IB.W, IB.H);
  return c;
}

/* ---------- 队伍（球员漫游 + 队内传球，传球速度每轮由计划指定） ---------- */
function makeTeam(team, rnd, passV) {
  const players = [];
  for (let i = 0; i < IB.nPerTeam; i++) players.push({
    team,                                  // 球员携带队伍标识（drawPlayer 按此取精灵）
    x: 110 + rnd() * (IB.W - 220), y: 110 + rnd() * (IB.H - 220),
    ang: rnd() * Math.PI * 2, sp: 62 + rnd() * 68,
  });
  return {
    team, players, passV,
    carrier: players[0], target: null,
    ballX: players[0].x, ballY: players[0].y,
    nextPassAt: 900 + rnd() * 1100,
    passes: 0,
  };
}

function updateTeam(team, dt, el, rnd) {
  team.players.forEach(p => {
    p.ang += (rnd() - 0.5) * 2.4 * dt;               // 缓慢随机转向
    p.x += Math.cos(p.ang) * p.sp * dt;
    p.y += Math.sin(p.ang) * p.sp * dt;
    const m = 70;                    // 边界余量（按精灵尺寸放大，防止出画）
    if (p.x < m || p.x > IB.W - m) { p.ang = Math.PI - p.ang; p.x = clamp(p.x, m, IB.W - m); }
    if (p.y < m || p.y > IB.H - m) { p.ang = -p.ang; p.y = clamp(p.y, m, IB.H - m); }
  });
  if (team.target) {                                  // 球在飞行中
    const t = team.target;
    const dx = t.x - team.ballX, dy = t.y - team.ballY;
    const d = Math.hypot(dx, dy), v = team.passV * dt;
    if (d <= v + 6) {                                 // 传球完成
      team.ballX = t.x; team.ballY = t.y;
      team.carrier = t; team.target = null; team.passes++;
      team.nextPassAt = el + 1100 + rnd() * 900;
    } else { team.ballX += dx / d * v; team.ballY += dy / d * v; }
  } else {                                            // 球在持球人脚下
    team.ballX = team.carrier.x; team.ballY = team.carrier.y + 14;
    if (el >= team.nextPassAt) {
      const mates = team.players.filter(p => p !== team.carrier);
      team.target = mates[Math.floor(rnd() * mates.length)];
    }
  }
}

function drawPlayer(ctx, p) {
  const img = IB_STATE.images[p.team];
  if (img && img.naturalWidth) {
    const h = IB.spriteH, w = h * (img.width / img.height);
    // 贴地软阴影（立体感，随精灵尺寸缩放）
    ctx.fillStyle = "rgba(0,0,0,.20)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + h / 2 - 4, w * 0.30, h * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h);
  } else {   // 素材缺失时的兜底图形
    ctx.fillStyle = p.team === "sheriff" ? "#fb923c" : "#8b5cf6";
    ctx.beginPath(); ctx.arc(p.x, p.y, 32, 0, Math.PI * 2);
    ctx.fill(); ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 3; ctx.stroke();
  }
}

function drawBall(ctx, team, x, y) {
  const c = IB.colors;
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2);   // 球半径 2×
  ctx.fillStyle = team === "sheriff" ? c.ballSheriff : c.ballWitch;
  ctx.strokeStyle = team === "sheriff" ? c.ballSheriffStroke : c.ballWitchStroke;
  ctx.lineWidth = 4; ctx.fill(); ctx.stroke();
}

/** 雨伞剪影（伞面半径 32 + 伞柄，总高约 74px；白色伞面在绿底上高对比） */
function drawUmbrella(ctx, x, y) {   // (x, y) 为伞面圆心
  const c = IB.colors;
  ctx.fillStyle = c.umb; ctx.strokeStyle = c.umbStroke; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 32, Math.PI, 0);                    // 伞面上沿（半圆）
  for (let i = 0; i < 3; i++) {                     // 底部三个扇贝边
    const x1 = x + 32 - (i + 1) * (64 / 3);
    const xc = x + 32 - (i + 0.5) * (64 / 3);
    ctx.quadraticCurveTo(xc, y + 11, x1, y);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = c.umbHandle; ctx.lineWidth = 4.5; // 伞柄 + 弯钩
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x, y + 36);
  ctx.quadraticCurveTo(x, y + 44, x + 9, y + 42);
  ctx.stroke();
}

/** 绘制意外刺激：雨伞或鹅形精灵（与球员同尺寸） */
function drawStim(ctx, stim, x, y) {
  if (stim === "umb") { drawUmbrella(ctx, x, y); return; }
  const img = IB_STATE.images[stim];
  if (img && img.naturalWidth) {
    const h = IB.stimH, w = h * (img.width / img.height);
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  } else {                                            // 兜底
    ctx.fillStyle = "#f8fafc"; ctx.strokeStyle = "#334155"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

/* ---------- 单段运行 ---------- */
/**
 * @param plan 本轮刺激计划 {stim, speed, dir, spawnAt, passVS, passVW}；练习段传 null
 * @param onDone({passes, traj, contact, gazeN, visMs, correctId, correctFeat, correctQuad, correctDir})
 */
function runSegment(plan, onDone) {
  const canvas = $("#stage-canvas");
  const ctx = canvas.getContext("2d");
  const segIdx = IB_STATE.segIdx++;
  const h = IB_STATE.pidHash;
  const rnd = RNG((h + segIdx * 97 + 1) >>> 0);
  const sheriff = makeTeam("sheriff", rnd, plan ? plan.passVS : 475);
  const witch = makeTeam("witch", rnd, plan ? plan.passVW : 475);

  let t0 = performance.now(), lastT = t0;
  const stim = { spawned: false, gone: false, x: 0, y: 0, vx: 0, vy: 0 };
  let traj = [];
  const gazeMark = { on: 0, off: 0 };

  function step(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05); lastT = now;
    const el = now - t0;
    updateTeam(sheriff, dt, el, rnd);
    updateTeam(witch, dt, el, rnd);

    // —— 意外刺激调度：按计划时刻出现 ——
    if (plan && !stim.spawned && el >= plan.spawnAt) {
      stim.spawned = true;
      const sp = IB.speeds[plan.speed];
      if (plan.dir === "S") {                       // 中央区域随机位置静止
        stim.x = IB.W * (0.30 + rnd() * 0.40);
        stim.y = IB.H * (0.30 + rnd() * 0.40);
      } else if (plan.dir === "L") { stim.x = -100; stim.y = IB.H * (0.10 + rnd() * 0.80); stim.vx = sp; }
      else if (plan.dir === "R") { stim.x = IB.W + 100; stim.y = IB.H * (0.10 + rnd() * 0.80); stim.vx = -sp; }
      else if (plan.dir === "T") { stim.y = -100; stim.x = IB.W * (0.10 + rnd() * 0.80); stim.vy = sp; }
      else { stim.y = IB.H + 100; stim.x = IB.W * (0.10 + rnd() * 0.80); stim.vy = -sp; }
      gazeMark.on = performance.now();
    }
    if (stim.spawned && !stim.gone) {
      stim.x += stim.vx * dt;
      stim.y += stim.vy * dt;
      traj.push({ x: stim.x, y: stim.y, t: now });
      const visDur = plan.dir === "S" ? 4000
        : ((plan.dir === "L" || plan.dir === "R") ? (IB.W + 200) : (IB.H + 200)) / IB.speeds[plan.speed] * 1000;
      const off = (plan.dir === "L" && stim.x > IB.W + 140) || (plan.dir === "R" && stim.x < -140) ||
                  (plan.dir === "T" && stim.y > IB.H + 140) || (plan.dir === "B" && stim.y < -140);
      if (now - gazeMark.on > visDur || off) { stim.gone = true; gazeMark.off = performance.now(); }
    }
    // 段结束时若刺激仍在场（理论上不会发生，兜底），按实际可见期关闭窗口
    if (stim.spawned && !stim.gone && el >= IB.segDur) {
      stim.gone = true; gazeMark.off = performance.now();
    }

    // —— 绘制（烘焙草坪背景仅 drawImage，零装饰，不占主线程） ——
    ctx.drawImage(IB_STATE.lawn, 0, 0);
    sheriff.players.concat(witch.players).forEach(p => drawPlayer(ctx, p));
    drawBall(ctx, "sheriff", sheriff.ballX, sheriff.ballY);
    drawBall(ctx, "witch", witch.ballX, witch.ballY);
    if (stim.spawned && !stim.gone) drawStim(ctx, plan.stim, stim.x, stim.y);

    if (el < IB.segDur) { IB_STATE.raf = requestAnimationFrame(step); }
    else {
      cancelAnimationFrame(IB_STATE.raf);
      // —— 正确答案 & 眼动接触率（有刺激的轮次） ——
      let gazeN = 0, contact = null, correctQuad = "", visMs = null;
      if (plan && traj.length) {
        const q = traj[Math.floor(traj.length * 0.7)];   // 以可见期 70% 处位置为准
        correctQuad = (q.x < IB.W / 2 ? "左" : "右") + (q.y < IB.H / 2 ? "上" : "下");
        visMs = gazeMark.off ? Math.round(gazeMark.off - gazeMark.on) : null;
      }
      if (plan && GZ.enabled && gazeMark.on && gazeMark.off) {
        const samples = GZ.window(gazeMark.on, gazeMark.off);
        gazeN = samples.length;
        if (gazeN) {
          const r = canvas.getBoundingClientRect();
          const margin = plan.stim === "umb" ? 130 : 150;   // 按刺激尺寸定接触邻域
          let hit = 0;
          samples.forEach(s => {
            let bi = 0, bd = 1e9;
            for (let i = 0; i < traj.length; i++) {
              const d = Math.abs(traj[i].t - s.t);
              if (d < bd) { bd = d; bi = i; }
            }
            const p = traj[bi];
            if (Math.hypot(s.x - (r.left + p.x), s.y - (r.top + p.y)) < margin) hit++;
          });
          contact = +(hit / gazeN).toFixed(3);
        }
      }
      onDone({
        passes: (IB_STATE.countTeam === "sheriff" ? sheriff : witch).passes,
        traj, contact, gazeN, visMs, correctQuad,
        correctId: plan ? (plan.stim === "umb" ? "雨伞" : "一只鹅") : "",
        correctFeat: plan ? (plan.stim === "coin" ? "手持一堆金币"
          : plan.stim === "maple" ? "胸口有红色枫叶徽章" : "") : "",
        correctDir: plan ? IB.dirCN[plan.dir] : "",
      });
    }
  }
  IB_STATE.raf = requestAnimationFrame(step);
}

/* ---------- 段间问答（计数报告 → 觉察二分 → 迫选组） ---------- */
function askBetween(title, fieldsHTML) {
  return new Promise(resolve => {
    const box = $("#ib-quiz");
    box.style.display = "flex";
    box.innerHTML = `
      <div class="card" style="max-width:560px;width:92%">
        <h2 style="margin-bottom:4px">${title}</h2>
        ${fieldsHTML}
        <div class="btn-row"><button class="btn" id="quiz-ok">确定</button></div>
      </div>`;
    box.querySelector("#quiz-ok").addEventListener("click", () => {
      // 校验：必填项（数字输入与非空单选）
      let ok = true;
      box.querySelectorAll("input[type=number][data-k]").forEach(el => {
        if (el.value === "" || isNaN(+el.value)) { el.style.borderColor = "#d05b4e"; ok = false; }
        else el.style.borderColor = "";
      });
      const names = [...new Set([...box.querySelectorAll("input[type=radio][data-k]")].map(r => r.name))];
      names.forEach(n => {
        if (!box.querySelector(`input[name=${n}]:checked`)) {
          box.querySelector(`input[name=${n}]`).closest(".field").style.background = "#fdeceb";
          ok = false;
        } else {
          box.querySelector(`input[name=${n}]`).closest(".field").style.background = "";
        }
      });
      if (!ok) return;
      const data = {};
      box.querySelectorAll("[data-k]").forEach(el => {
        if (el.type === "radio") { if (el.checked) data[el.dataset.k] = el.value; }
        else data[el.dataset.k] = el.value;
      });
      box.style.display = "none";
      resolve(data);
    });
  });
}

const teamCN = () => IB.teamCN[IB_STATE.countTeam];

async function segmentAndAsk(phase, segNo, segTotal, plan) {
  const d = await new Promise(res => runSegment(plan, res));
  // 1) 主任务报告
  const q1 = await askBetween("这一段动画结束了", `
    <div class="field"><label>你数到的<b>${teamCN()}的传球次数</b>大约是多少？</label>
    <input type="number" data-k="countReport" min="0" max="99" style="width:130px"></div>`);
  // 2) 觉察二分（每段都问，维持一致的外部结构）
  const q2 = await askBetween("几个关于刚才动画的问题", `
    <div class="field"><label>在刚才的动画中，你是否看到了一个<b>不属于两队球员的异常物体</b>？</label>
      <div class="radio-row">
        <label><input type="radio" name="saw" data-k="noticed" value="1"> 看到</label>
        <label><input type="radio" name="saw" data-k="noticed" value="0"> 没有看到</label>
      </div></div>`);
  // 3) 迫选组（仅报告看到）：身份 + 区域 + 运动方向
  let fc = {};
  if (q2.noticed === "1") {
    fc = await askBetween("请再回答三个问题", `
      <div class="field"><label>那个物体更像是下面的哪一个？</label>
        <div class="radio-row">${IB.fcIdOptions.map(o =>
          `<label><input type="radio" name="fci" data-k="fcId" value="${o}"> ${o}</label>`).join("")}
        </div></div>
      <div class="field"><label>它大致出现在屏幕的哪个区域？</label>
        <div class="radio-row">${IB.fcQuads.map(o =>
          `<label><input type="radio" name="fcq" data-k="fcQuad" value="${o}"> ${o}</label>`).join("")}
        </div></div>
      <div class="field"><label>它是如何运动的？</label>
        <div class="radio-row">${IB.fcDirOptions.map(o =>
          `<label><input type="radio" name="fcd" data-k="fcDir" value="${o}"> ${o}</label>`).join("")}
        </div></div>`);
    // 4) 特征迫选（仅当报告「一只鹅」）
    if (fc.fcId === "一只鹅") {
      const q4 = await askBetween("关于这只鹅的一个问题", `
        <div class="field"><label>这只鹅有什么特征？</label>
          <div class="radio-row">${IB.fcFeatOptions.map(o =>
            `<label><input type="radio" name="fcf" data-k="fcFeat" value="${o}"> ${o}</label>`).join("")}
          </div></div>`);
      fc.fcFeat = q4.fcFeat;
    }
  }
  // —— 落库（每轮一条记录，含全部条件与正确性）——
  Collector.push({
    seg: segNo, phase,
    stim: plan ? plan.stim : "none",            // 练习段无刺激
    speed: plan ? plan.speed : "",
    dir: plan ? plan.dir : "",
    spawnAt: plan ? plan.spawnAt : null,
    passVS: plan ? plan.passVS : null, passVW: plan ? plan.passVW : null,
    countTeam: IB_STATE.countTeam,
    passes: d.passes, countReport: +q1.countReport,
    countErr: Math.abs(+q1.countReport - d.passes),
    noticed: +(q2.noticed),
    fcId: fc.fcId || "", fcIdCorr: fc.fcId ? (fc.fcId === d.correctId ? 1 : 0) : null,
    fcFeat: fc.fcFeat || "",
    fcFeatCorr: fc.fcFeat ? (fc.fcFeat === d.correctFeat ? 1 : 0) : null,
    fcQuad: fc.fcQuad || "", fcQuadCorr: fc.fcQuad ? (fc.fcQuad === d.correctQuad ? 1 : 0) : null,
    fcDir: fc.fcDir || "", fcDirCorr: fc.fcDir ? (fc.fcDir === d.correctDir ? 1 : 0) : null,
    stimVisMs: d.visMs,
    gazeN: d.gazeN, contact: d.contact, gazeSrc: GZ.source,
  });
}

/* ---------- 流程 ---------- */
async function startPractice() {
  Collector.begin("ib_multistim", "within_speed_x_identity_x_round");
  Progress.show();
  Progress.set(0.03, `练习段 · 专注数${teamCN()}传球`);
  $("#stage-hint").textContent = `练习段：只数${teamCN()}的传球次数`;
  await segmentAndAsk("practice", 0, 7, null);
  ibTransition();
}

/* 练习 → 正式过渡页（明确区分练习与正式试次） */
function ibTransition() {
  $("#stage").classList.remove("on");
  $("#app").style.display = "block";
  $("#app").innerHTML = `
  <div class="card fade">
    <h1>练习试次已完成</h1>
    <div class="steps"><div class="step done">知情同意</div><div class="step done">指导语</div><div class="step done">练习段</div><div class="step on">正式实验</div><div class="step">结束</div></div>
    <div class="callout"><b>练习试次结束，请点击下方按钮进入正式实验</b><br>
      正式实验共 <b>6 段</b>动画，流程与练习完全相同：每段约 15 秒，结束后先报告
      <b>${teamCN()}的传球次数</b>，再回答几个小问题。请像刚才一样专注完成计数任务。</div>
    <div class="btn-row"><button class="btn" id="btn-formal">进入正式实验</button></div>
  </div>`;
  $("#btn-formal").addEventListener("click", () => {
    $("#app").style.display = "none";
    $("#stage").classList.add("on");
    runFormalSegments();
  });
}

async function runFormalSegments() {
  for (let i = 0; i < IB_STATE.schedule.length; i++) {
    const plan = IB_STATE.schedule[i];
    Progress.set((i + 1) / 7, `正式片段 ${i + 1}/6 · 专注数${teamCN()}传球`);
    $("#stage-hint").textContent = `正式片段 ${i + 1}/6：只数${teamCN()}的传球次数`;
    await segmentAndAsk("critical", i + 1, 7, plan);
  }
  ibFinish();
}

async function ibFinish() {
  $("#stage").classList.remove("on");
  Progress.set(1, "完成");
  const sub = await Collector.submit();
  GZ.stop();
  const trials = Collector.trials.filter(t => t.phase === "critical");
  const noticedN = trials.filter(t => t.noticed === 1).length;
  $("#app").style.display = "block";
  $("#app").innerHTML = `
  <div class="card fade">
    <h1>实验完成，感谢参与！</h1>
    <p>被试编号 <b>${Session.pid}</b> · 察觉异常物体 <b>${noticedN}/${trials.length}</b> 轮 ·
       数据上传：<b class="${sub.ok ? "badge ok" : "badge err"}">${sub.ok ? ("成功" + (sub.warnings ? "（服务器清洗提示：" + (Array.isArray(sub.warnings) ? sub.warnings.join("；") : sub.warnings) + "）" : "")) : "失败（" + (sub.reason || sub.status) + "）"}</b></p>
    <div class="chart-box"><h3>你的 6 轮察觉情况</h3>
      <table class="table">
        <tr><th>轮次</th><th>意外物体</th><th>运动方式</th><th>是否察觉</th></tr>
        ${trials.map(t => `<tr><td>${t.seg}</td><td>${IB.stimCN[t.stim]}</td>
          <td>${IB.speedCN[t.speed]}${t.dir && t.dir !== "S" ? (["L", "R"].includes(t.dir) ? " · 横穿" : " · 竖穿") : ""}</td>
          <td>${t.noticed ? "✔ 看到" : "— 未察觉"}</td></tr>`).join("")}
      </table></div>
    <div class="chart-box"><h3>你的分条件察觉率</h3>
      <table class="table">
        <tr><th>条件</th><th>轮次数</th><th>察觉率</th></tr>
        <tr><td colspan=3 style="font-weight:600">按运动速度</td></tr>
        ${["fast", "slow", "static"].map(k => { const a = trials.filter(t => t.speed === k);
          return `<tr><td>${IB.speedCN[k]}</td><td>${a.length}</td><td>${a.length ? (a.filter(t => t.noticed).length / a.length * 100).toFixed(0) + "%" : "—"}</td></tr>`; }).join("")}
        <tr><td colspan=3 style="font-weight:600">按形象</td></tr>
        ${["umb", "coin", "maple"].map(k => { const a = trials.filter(t => t.stim === k);
          return `<tr><td>${IB.stimCN[k]}</td><td>${a.length}</td><td>${a.length ? (a.filter(t => t.noticed).length / a.length * 100).toFixed(0) + "%" : "—"}</td></tr>`; }).join("")}
      </table></div>
    <div id="my-result"></div>
    <div class="callout"><b>实验解密（事后说明）</b><br>
      在每一段正式动画中，都出现了一个<b>不属于两队球员的物体</b>——可能是
      一把白色雨伞、一只手持金币的鹅、或一只胸口戴枫叶徽章的鹅。
      它们以不同方式出现：<b>快速穿过 / 缓慢穿过 / 原地静止约 4 秒</b>，
      方向随机（左右横穿或上下竖穿），两队的传球速度也在每轮间变化。
      这就是经典的「非注意盲」范式：当你专注于数传球时，即使物体就在眼前，也可能视而不见。
      本实验采用<b>被试内设计</b>检验两点：① <b>运动速度</b>是否决定意外物体被察觉
      （与 Wood & Simons 2023 的方向一致）；② 与被注意球员<b>同类别</b>的鹅形刺激
      是否比无关的雨伞更容易被察觉（注意定势/相似性假设，Most et al. 2005）；
      同时观察随着轮次增加、被试知道「可能有异常物体」后察觉率的变化（预期/注意分配效应）。</div>
    <p class="muted">多被试汇总、Cochran's Q 检验与模型预测线详见
      <a href="../results.html">结果与模型可视化页</a>（收集多名被试后导入 CSV 即可查看）。</p>
    <div class="btn-row">
      <button class="btn ghost" onclick="Collector.exportCSV()">导出 CSV（上传失败时用）</button>
      <a class="btn gray" href="../index.html">返回首页</a>
    </div>
  </div>`;
  // 渲染「我的结果 + 全班对比」
  renderMyResult("ib", trials);
}

/* ---------- 启动 ---------- */
window.addEventListener("DOMContentLoaded", () => {
  $("#app").innerHTML = buildConsentFlow("专注计数与非注意盲 —— 意外物体的形象、速度与方向", `
      你将观看几段 15 秒的动画：草坪上两支球队（警长队 / 巫医队）的队员移动并互相传球。
      你的任务是<b>数出指定一支球队的传球次数</b>。每段结束后回答问题。`);
  bindConsentFlow(() => {
    // 被试内设计：6 轮计划（形象×速度平衡、方向与传球速度随机）由被试编号哈希决定，可复现
    const h = [...Session.pid].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
    IB_STATE.pidHash = h;
    IB_STATE.countTeam = Math.floor(h / 3) % 2 ? "witch" : "sheriff";
    IB_STATE.schedule = buildSchedule(RNG((h ^ 0xC0FFEE) >>> 0));
    IB_STATE.segIdx = 0;

    $("#app").innerHTML = `
    <div class="card fade">
      <h1>指导语</h1>
      <div class="steps"><div class="step on">知情同意</div><div class="step on">指导语</div><div class="step">练习段</div><div class="step">正式片段×6</div><div class="step">结束</div></div>
      <p>画面是一片草坪，草坪上有两支球队：<b>警长队</b>和<b>巫医队</b>，各 4 名队员，
      每队一颗球在队员之间传递（警长队为橙色球，巫医队为紫色球）。两队传球的速度会不时变化。</p>
      <ul class="tight">
        <li><b>只数${teamCN()}的传球次数</b>（另一队的传球不用管）；</li>
        <li>动画结束后输入你数到的总次数（估计值即可，不必精确）；</li>
        <li>先完成 1 段练习，再进入 6 段正式动画，每段约 15 秒。</li>
      </ul>
      <div class="callout"><b>要求</b>：计数期间请始终注视画面，尽量不要频繁眨眼。</div>
      <p class="muted">请保持头部位置相对稳定（如开启了眼动记录）。</p>
      <div class="btn-row"><button class="btn" id="btn-start" disabled>加载素材…</button></div>
    </div>`;
    // 预载 4 个精灵（两队球员 + 两个意外刺激形象）+ 烘焙草坪
    let loaded = 0;
    const allKeys = Object.keys(IB.sprites);
    allKeys.forEach(t => {
      const img = new Image();
      img.onload = img.onerror = () => {
        if (++loaded === allKeys.length) {
          IB_STATE.lawn = makeLawn();
          const b = $("#btn-start"); b.disabled = false; b.textContent = "开始练习段";
        }
      };
      img.src = IB.sprites[t];
      IB_STATE.images[t] = img;
    });
    $("#btn-start").addEventListener("click", () => {
      if (!IB_STATE.lawn) IB_STATE.lawn = makeLawn();   // 兜底
      document.body.insertAdjacentHTML("beforeend", `
      <div class="stage" id="stage">
        <canvas id="stage-canvas" width="900" height="600"></canvas>
        <div class="hint" id="stage-hint"></div>
        <div id="ib-quiz" style="display:none;position:fixed;inset:0;z-index:70;
             background:rgba(24,24,27,.78);align-items:center;justify-content:center"></div>
      </div>`);
      $("#stage").classList.add("on");
      $("#app").style.display = "none";
      startPractice();
    });
  });
});
