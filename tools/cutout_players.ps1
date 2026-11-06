# ============================================================
# cutout_players.ps1 -- v4: cut character out of white-bg card art
# Usage: powershell -File cutout_players.ps1 -Src <card.png> -Dst <out.png> [-OutH 400]
# Pipeline (GDI+ / C#):
#   1) flood-fill near-white background from image borders -> alpha 0
#   2) keep only the largest 4-connected opaque component
#      (removes card text / watermark / sparkles)
#   3) edge feather: pixels within 2px of the cut get alpha from
#      distance-to-white and are un-premultiplied from white
#      (kills the white fringe when composited on dark backgrounds)
#   4) crop tight bbox (+2px), resize to height OutH, save PNG
# ============================================================
param([Parameter(Mandatory=$true)][string]$Src,
      [Parameter(Mandatory=$true)][string]$Dst,
      [int]$OutH = 400)

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DuckCutout4 {
  public static string Process(string src, string dst, int outH) {
    using (Bitmap bmp = (Bitmap)Bitmap.FromFile(src)) {
      int W = bmp.Width, H = bmp.Height;
      Rectangle rect = new Rectangle(0, 0, W, H);
      BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      int stride = data.Stride;
      byte[] b = new byte[stride * H];
      Marshal.Copy(data.Scan0, b, 0, b.Length);
      Func<int,int,int> At = (x, y) => y * stride + x * 4;
      Func<int,int,bool> nearWhite = (x, y) => {
        int o = At(x, y);
        return b[o] >= 238 && b[o+1] >= 238 && b[o+2] >= 238;
      };
      Func<int,int,bool> opaque = (x, y) => b[At(x, y) + 3] != 0;

      // ---- 1) flood fill near-white background from borders ----
      Queue<int> q = new Queue<int>();
      bool[] seen = new bool[W * H];
      for (int x = 0; x < W; x++) {
        if (nearWhite(x, 0))     { seen[x] = true; q.Enqueue(x); }
        if (nearWhite(x, H - 1)) { int i = (H-1)*W + x; if(!seen[i]){ seen[i] = true; q.Enqueue(i);} }
      }
      for (int y = 0; y < H; y++) {
        if (nearWhite(0, y))     { int i = y*W;     if(!seen[i]){ seen[i] = true; q.Enqueue(i);} }
        if (nearWhite(W-1, y))   { int i = y*W+W-1; if(!seen[i]){ seen[i] = true; q.Enqueue(i);} }
      }
      int removed = 0;
      while (q.Count > 0) {
        int i = q.Dequeue(); int x = i % W, y = i / W;
        if (b[At(x, y) + 3] == 0) continue;
        b[At(x, y) + 3] = 0; removed++;
        if (x > 0     && !seen[i-1] && nearWhite(x-1, y)) { seen[i-1] = true; q.Enqueue(i-1); }
        if (x < W - 1 && !seen[i+1] && nearWhite(x+1, y)) { seen[i+1] = true; q.Enqueue(i+1); }
        if (y > 0     && !seen[i-W] && nearWhite(x, y-1)) { seen[i-W] = true; q.Enqueue(i-W); }
        if (y < H - 1 && !seen[i+W] && nearWhite(x, y+1)) { seen[i+W] = true; q.Enqueue(i+W); }
      }
      if (removed < W * H / 20)
        throw new Exception("flood fill removed only " + removed + " px -- background not detected?");

      // ---- 2) largest 4-connected opaque component ----
      int[] label = new int[W * H];
      int cur = 0, bestLabel = 0, bestArea = 0;
      int bx0 = W, by0 = H, bx1 = 0, by1 = 0;
      Stack<int> stack = new Stack<int>();
      for (int yy = 0; yy < H; yy++) {
        for (int xx = 0; xx < W; xx++) {
          int i0 = yy * W + xx;
          if (label[i0] != 0 || !opaque(xx, yy)) continue;
          cur++;
          int area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
          stack.Clear(); stack.Push(i0); label[i0] = cur;
          while (stack.Count > 0) {
            int j = stack.Pop();
            int jx = j % W, jy = j / W;
            area++;
            if (jx < x0) x0 = jx; if (jx > x1) x1 = jx;
            if (jy < y0) y0 = jy; if (jy > y1) y1 = jy;
            if (jx > 0)     { int k = j - 1; if (label[k] == 0 && opaque(k % W, k / W)) { label[k] = cur; stack.Push(k); } }
            if (jx < W - 1) { int k = j + 1; if (label[k] == 0 && opaque(k % W, k / W)) { label[k] = cur; stack.Push(k); } }
            if (jy > 0)     { int k = j - W; if (label[k] == 0 && opaque(k % W, k / W)) { label[k] = cur; stack.Push(k); } }
            if (jy < H - 1) { int k = j + W; if (label[k] == 0 && opaque(k % W, k / W)) { label[k] = cur; stack.Push(k); } }
          }
          if (area > bestArea) {
            bestArea = area; bestLabel = cur;
            bx0 = x0; by0 = y0; bx1 = x1; by1 = y1;
          }
        }
      }
      for (int i = 0; i < W * H; i++)
        if (label[i] != 0 && label[i] != bestLabel) b[(i / W) * stride + (i % W) * 4 + 3] = 0;

      // ---- 3) edge feather + un-premultiply from white ----
      // band = opaque pixels within 2px (Chebyshev) of a transparent pixel
      bool[] t1 = new bool[W * H];
      for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++)
          if (!opaque(x, y)) t1[y * W + x] = true;
      bool[] t2 = new bool[W * H];
      for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) {
          int i = y * W + x;
          if (t1[i]) { t2[i] = true; continue; }
          bool near = false;
          for (int dy = -2; dy <= 2 && !near; dy++)
            for (int dx = -2; dx <= 2; dx++) {
              int nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < W && ny >= 0 && ny < H && t1[ny * W + nx]) { near = true; break; }
            }
          t2[i] = near;
        }
      int feathered = 0;
      for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) {
          int i = y * W + x;
          if (!opaque(x, y) || !t2[i]) continue;
          int o = At(x, y);
          int r = b[o], g = b[o+1], bl = b[o+2];
          int mn = Math.Min(r, Math.Min(g, bl));
          if (mn >= 250) { b[o + 3] = 0; feathered++; continue; }   // pure white fringe -> cut
          double a = Math.Min(1.0, (255.0 - mn) / 60.0);            // 0..1
          if (a < 1.0) {
            double ia = 1.0 - a;
            int fr = (int)Math.Round((r - ia * 255.0) / a);
            int fg = (int)Math.Round((g - ia * 255.0) / a);
            int fb = (int)Math.Round((bl - ia * 255.0) / a);
            b[o]   = (byte)Math.Max(0, Math.Min(255, fr));
            b[o+1] = (byte)Math.Max(0, Math.Min(255, fg));
            b[o+2] = (byte)Math.Max(0, Math.Min(255, fb));
            b[o+3] = (byte)Math.Round(a * 255.0);
            feathered++;
          }
        }

      Marshal.Copy(b, 0, data.Scan0, b.Length);
      bmp.UnlockBits(data);

      // ---- 4) crop tight bbox (+2px) and resize to outH ----
      int m = 2;
      int cx0 = Math.Max(0, bx0 - m), cy0 = Math.Max(0, by0 - m);
      int cx1 = Math.Min(W - 1, bx1 + m), cy1 = Math.Min(H - 1, by1 + m);
      int cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
      using (Bitmap crop = bmp.Clone(new Rectangle(cx0, cy0, cw, ch), PixelFormat.Format32bppArgb))
      using (Bitmap outB = new Bitmap(Math.Max(1, cw * outH / ch), outH, PixelFormat.Format32bppArgb))
      using (Graphics g = Graphics.FromImage(outB)) {
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
        g.DrawImage(crop, 0, 0, outB.Width, outB.Height);
        outB.Save(dst, ImageFormat.Png);
      }
      return string.Format("src {0}x{1}, bg removed {2}px, best comp {3}px bbox[{4},{5}]-[{6},{7}], feathered {8}px -> {9}x{10}",
        W, H, removed, bestArea, bx0, by0, bx1, by1, feathered, cw * outH / ch, outH);
    }
  }
}
"@

$info = [DuckCutout4]::Process($Src, $Dst, $OutH)
Write-Host ("OK {0} -> {1} ({2} bytes)" -f (Split-Path $Src -Leaf), $Dst, (Get-Item $Dst).Length)
Write-Host $info
