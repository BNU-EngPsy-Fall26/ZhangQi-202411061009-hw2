# ============================================================
# render_ai_stimuli.ps1 —— C&M AI 预跑刺激包离线渲染（部分-整体比例版）
# 与 js/cm_stimuli.js 的 CM_GEO 几何规范逐像素一致
# 输出：ai/cm_stimuli_png/C01..C16.png + ai/cm_prompts.json + ai/ai_results.json（模板）
# 编码：UTF-8 BOM（PowerShell 5.1 依赖 BOM 识别中文，勿改）
# ============================================================
Add-Type -AssemblyName System.Drawing

$root = "c:\Users\wai\OneDrive\桌面\工程心理学作业2\attention-lab-hw2"
$outDir = Join-Path $root "ai\cm_stimuli_png"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# ---- 几何常量（与 CM_GEO 一致） ----
$W, $H = 800, 420
# position 标尺
$rulerX0, $rulerX1, $rulerY, $rulerH = 100, 700, 210, 18
# length 双线段
$segX, $segL, $segYTop, $segYBot, $segTh = 160, 480, 150, 270, 18
# angle 整圆
$pieCx, $pieCy, $pieR = 400, 210, 150
# area 同心圆
$areaCx, $areaCy, $areaR = 400, 210, 130

$cSmall  = [System.Drawing.Color]::FromArgb(37, 99, 235)    # #2563eb 蓝
$cLarge  = [System.Drawing.Color]::FromArgb(203, 213, 225)  # #cbd5e1 灰
$cStroke = [System.Drawing.Color]::FromArgb(71, 85, 105)    # #475569

function New-Canvas {
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::White)
    return ,@($bmp, $g)
}

function Draw-Chart($bmp, $g, $enc, $ratio, $side) {
    $penStroke = New-Object System.Drawing.Pen($cStroke, 2)
    $brushS = New-Object System.Drawing.SolidBrush($cSmall)
    $brushL = New-Object System.Drawing.SolidBrush($cLarge)

    if ($enc -eq "position") {
        # 灰色全长 + 蓝色从左端到标记刻度 + 端点/刻度线
        $xm = $rulerX0 + $ratio * ($rulerX1 - $rulerX0)
        $g.FillRectangle($brushL, $rulerX0, ($rulerY - $rulerH / 2), ($rulerX1 - $rulerX0), $rulerH)
        $g.FillRectangle($brushS, $rulerX0, ($rulerY - $rulerH / 2), ($xm - $rulerX0), $rulerH)
        $penTick = New-Object System.Drawing.Pen($cStroke, 3)
        foreach ($x in @($rulerX0, $rulerX1)) {
            $g.DrawLine($penTick, $x, ($rulerY - 26), $x, ($rulerY + 26))
        }
        $g.DrawLine($penTick, $xm, ($rulerY - 34), $xm, ($rulerY + 34))
    }
    elseif ($enc -eq "length") {
        # 两条圆头线段：灰全长 L、蓝 ratio*L；side 决定上下
        $yS = if ($side -eq 0) { $segYTop } else { $segYBot }   # 蓝
        $yL = if ($side -eq 0) { $segYBot } else { $segYTop }   # 灰
        $penL = New-Object System.Drawing.Pen($cLarge, $segTh)
        $penS = New-Object System.Drawing.Pen($cSmall, $segTh)
        foreach ($p in @($penL, $penS)) {
            $p.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $p.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
        }
        $x0c = $segX + $segTh / 2
        $g.DrawLine($penL, $x0c, $yL, ($segX + $segL - $segTh / 2), $yL)
        $g.DrawLine($penS, $x0c, $yS, ($x0c + $ratio * ($segL - $segTh)), $yS)
    }
    elseif ($enc -eq "angle") {
        # 灰满圆 + 蓝扇区从 12 点（270°）顺时针 sweep = ratio*360°
        $rect = New-Object System.Drawing.Rectangle(($pieCx - $pieR), ($pieCy - $pieR), ($pieR * 2), ($pieR * 2))
        $sweep = $ratio * 360
        $g.FillEllipse($brushL, $rect)
        $g.FillPie($brushS, $rect, 270, $sweep)
        $g.DrawEllipse($penStroke, $rect)
        $a = [Math]::PI * (270 + $sweep) / 180
        $g.DrawLine($penStroke, $pieCx, $pieCy, $pieCx, ($pieCy - $pieR))
        $g.DrawLine($penStroke, $pieCx, $pieCy, ($pieCx + $pieR * [Math]::Cos($a)), ($pieCy + $pieR * [Math]::Sin($a)))
    }
    elseif ($enc -eq "area") {
        # 同心圆：灰大圆 R + 蓝小圆 r = R*sqrt(ratio)
        $rS = $areaR * [Math]::Sqrt($ratio)
        $rectL = New-Object System.Drawing.Rectangle(($areaCx - $areaR), ($areaCy - $areaR), ($areaR * 2), ($areaR * 2))
        $g.FillEllipse($brushL, $rectL); $g.DrawEllipse($penStroke, $rectL)
        $rectS = New-Object System.Drawing.Rectangle(($areaCx - $rS), ($areaCy - $rS), ($rS * 2), ($rS * 2))
        $g.FillEllipse($brushS, $rectS); $g.DrawEllipse($penStroke, $rectS)
    }
}

# ---- 生成 16 张图（4 编码 × 4 比例，side = (ei+ri)%2，仅 length 使用） ----
$encodings = @("position", "length", "angle", "area")
$encCN     = @{ position = "位置"; length = "长度"; angle = "角度"; area = "面积" }
$ratios    = @(0.25, 0.40, 0.60, 0.75)
$promptTail = "请只回答一个 0 到 100 之间的整数，不要输出任何其他文字。"
# 分编码提问（与网页端 CM_Q 完全一致，保证人类与 AI 题目相同）
$prompts = @{
    position = "这是测试图形知觉的统计图形。图中有一条标尺，蓝色线段从左端延伸到标记刻度。请估计：蓝色线段占整条标尺长度的百分之多少？$promptTail"
    length   = "这是测试图形知觉的统计图形。图中有两条线段，蓝色较短、灰色较长。请估计：蓝色线段的长度是灰色线段的百分之多少？$promptTail"
    angle    = "这是测试图形知觉的统计图形。图中有一个圆形，蓝色扇区从12点方向顺时针展开。请估计：蓝色扇区占整个圆形的百分之多少？$promptTail"
    area     = "这是测试图形知觉的统计图形。图中有两个同心圆，蓝色在内、灰色在外。请估计：蓝色圆形的面积是灰色圆形面积的百分之多少？$promptTail"
}

$trials = @(); $k = 0
for ($ei = 0; $ei -lt $encodings.Count; $ei++) {
    for ($ri = 0; $ri -lt $ratios.Count; $ri++) {
        $enc = $encodings[$ei]; $ratio = $ratios[$ri]
        $side = ($ei + $ri) % 2
        $k++
        $id = "C{0:D2}" -f $k
        $file = "{0}_{1}_{2}.png" -f $id, $enc, [int]($ratio * 100)
        $c = New-Canvas
        Draw-Chart $c[0] $c[1] $enc $ratio $side
        $c[1].Dispose()
        $c[0].Save((Join-Path $outDir $file), [System.Drawing.Imaging.ImageFormat]::Png)
        $c[0].Dispose()
        $trials += [ordered]@{
            id = $id; image = "cm_stimuli_png/$file"; enc = $enc; enc_cn = $encCN[$enc]
            ratio = $ratio; true_pct = [int]($ratio * 100); side = $side; prompt = $prompts[$enc]
        }
    }
}

# ---- 写 cm_prompts.json ----
$package = [ordered]@{
    task = "Cleveland & McGill (1984) 图形比例知觉估计 —— 多模态大模型同题作答（部分-整体比例版）"
    note = "每条 trial 对应一张图；将图片与 prompt 一起发给 LLM（prompt 按编码类型区分提问），把估计值（0-100 整数）填入 ai_results.json 的 results.estimate"
    trials = $trials
}
$package | ConvertTo-Json -Depth 5 | Out-File (Join-Path $root "ai\cm_prompts.json") -Encoding utf8

# ---- 写 ai_results.json 模板 ----
$template = [ordered]@{
    model = "（填写模型名称，如 gpt-5 / gemini-2.5-pro / claude-sonnet-4.5）"
    date = (Get-Date -Format "yyyy-MM-dd")
    n_runs = 1
    note = "同一图片可多次询问（n_runs>1），estimate 填多次的平均或逐次填写 run1/run2 字段"
    results = $trials | ForEach-Object { [ordered]@{ id = $_.id; estimate = $null } }
}
$template | ConvertTo-Json -Depth 5 | Out-File (Join-Path $root "ai\ai_results.json") -Encoding utf8

Write-Output ("已生成 {0} 张刺激图 + cm_prompts.json + ai_results.json 模板" -f $trials.Count)
Get-ChildItem $outDir | Select-Object Name, Length | Format-Table -AutoSize
