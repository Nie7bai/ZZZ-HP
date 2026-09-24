Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;

public static class BannerGen
{
    private static string GetString(string json, string key)
    {
        string needle = "\"" + key + "\"";
        int i = json.IndexOf(needle, StringComparison.Ordinal);
        if (i < 0) return "";
        i = json.IndexOf(':', i);
        i = json.IndexOf('"', i) + 1;
        int j = json.IndexOf('"', i);
        return json.Substring(i, j - i);
    }

    private static List<string> GetArray(string json, string key)
    {
        var list = new List<string>();
        string needle = "\"" + key + "\"";
        int i = json.IndexOf(needle, StringComparison.Ordinal);
        if (i < 0) return list;
        i = json.IndexOf('[', i) + 1;
        int close = json.IndexOf(']', i);
        if (close < 0) return list;
        while (i < close)
        {
            int q = json.IndexOf('"', i);
            if (q < 0 || q > close) break;
            int q2 = json.IndexOf('"', q + 1);
            if (q2 < 0 || q2 > close) break;
            list.Add(json.Substring(q + 1, q2 - q - 1));
            i = q2 + 1;
        }
        return list;
    }

    private static Color C(int a, string hex)
    {
        return Color.FromArgb(a, ColorTranslator.FromHtml(hex));
    }

    private static Pen Pen(int a, string hex, float w)
    {
        var p = new Pen(C(a, hex), w);
        p.StartCap = LineCap.Round;
        p.EndCap = LineCap.Round;
        return p;
    }

    public static void Run(string textsPath, string outPath)
    {
        string json = File.ReadAllText(textsPath);
        string eyebrow = GetString(json, "eyebrow");
        string title = GetString(json, "title");
        string sub1 = GetString(json, "sub1");
        string sub2 = GetString(json, "sub2");
        List<string> chips = GetArray(json, "chips");
        string foot = GetString(json, "foot");
        string card1k = GetString(json, "card1k");
        string card1v = GetString(json, "card1v");
        string card2k = GetString(json, "card2k");
        string card2v = GetString(json, "card2v");

        int W = 2560, H = 640;
        using (var bmp = new Bitmap(W, H))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAlias;

            // background gradient
            var bgRect = new Rectangle(0, 0, W, H);
            using (var bgBrush = new LinearGradientBrush(bgRect,
                ColorTranslator.FromHtml("#0b0e14"), ColorTranslator.FromHtml("#0e1219"), 135f))
            {
                g.FillRectangle(bgBrush, bgRect);
            }

            // glow spots
            Glow(g, 2010, 40, 820, 58, "#4cc2c2");
            Glow(g, 200, 700, 660, 66, "#c9a55c");
            Glow(g, 1400, 740, 500, 30, "#35a7ff");

            // grid
            using (var gridPen = Pen(11, "#ffffff", 1))
            {
                for (int x = 0; x <= W; x += 56) g.DrawLine(gridPen, x, 0, x, H);
                for (int y = 0; y <= H; y += 56) g.DrawLine(gridPen, 0, y, W, y);
            }

            // rings
            Ring(g, 1400, 76, 560, 76, "#c9a55c", 3.0f);
            Ring(g, 1480, 156, 400, 96, "#4cc2c2", 2.0f);
            Ring(g, 1560, 236, 240, 115, "#35a7ff", 2.0f);
            Ring(g, 1628, 304, 96, 153, "#c9a55c", 2.0f);
            Ring(g, 1300, 366, 700, 30, "#c9a55c", 2.0f);

            // hexagons
            Hex(g, 1620, 246, 110, 66, "#c9a55c", 15);
            Hex(g, 1850, 456, 60, 72, "#4cc2c2", -8);
            Hex(g, 1980, 206, 34, 87, "#35a7ff", 0);

            // data cards
            Card(g, 1390, 168, card1k, card1v, "#f2d98e");
            Card(g, 1740, 350, card2k, card2v, "#4cc2c2");

            // eyebrow pill
            using (var ebf = new Font("Microsoft YaHei", 22f))
            {
                var ebSize = g.MeasureString(eyebrow, ebf);
                float ebW = ebSize.Width + 54, ebH = 52, ebX = 120, ebY = 74;
                using (var path = new GraphicsPath())
                {
                    path.AddArc(ebX, ebY, ebH, ebH, 180, 90);
                    path.AddArc(ebX + ebW - ebH, ebY, ebH, ebH, 270, 90);
                    path.AddArc(ebX + ebW - ebH, ebY, ebH, ebH, 0, 90);
                    path.AddArc(ebX, ebY, ebH, ebH, 90, 90);
                    path.CloseFigure();
                    using (var b = Pen(128, "#aab2c2", 1.4f)) g.DrawPath(b, path);
                }
                using (var br = new SolidBrush(C(255, "#aab2c2")))
                    g.DrawString(eyebrow, ebf, br, ebX + 27, ebY + 7);
            }

            // title
            using (var tf = new Font("Microsoft YaHei", 170f, FontStyle.Bold))
            {
                var tSize = g.MeasureString(title, tf);
                var tRect = new RectangleF(120, 150, tSize.Width + 40, tSize.Height + 20);
                using (var tBrush = new LinearGradientBrush(tRect,
                    ColorTranslator.FromHtml("#f2d98e"), ColorTranslator.FromHtml("#b8944a"), 40f))
                {
                    g.DrawString(title, tf, tBrush, 120, 150);
                }
            }

            // subtitle
            using (var sf = new Font("Microsoft YaHei", 38f))
            using (var subBrush = new SolidBrush(C(255, "#c9ced9")))
            using (var emBrush = new SolidBrush(C(255, "#4cc2c2")))
            {
                g.DrawString(sub1, sf, emBrush, 120, 414);
                var s1Size = g.MeasureString(sub1, sf);
                g.DrawString(sub2, sf, subBrush, 120 + s1Size.Width, 414);
            }

            // chips
            using (var chipFont = new Font("Microsoft YaHei", 22f))
            {
                float chipY = 484, chipH = 54, gap = 18, chipX = 120;
                for (int i = 0; i < chips.Count; i++)
                {
                    string label = chips[i];
                    var cSize = g.MeasureString(label, chipFont);
                    float cW = cSize.Width + 48;
                    using (var path = new GraphicsPath())
                    {
                        path.AddArc(chipX, chipY, chipH, chipH, 180, 90);
                        path.AddArc(chipX + cW - chipH, chipY, chipH, chipH, 270, 90);
                        path.AddArc(chipX + cW - chipH, chipY, chipH, chipH, 0, 90);
                        path.AddArc(chipX, chipY, chipH, chipH, 90, 90);
                        path.CloseFigure();
                        if (i == 0)
                        {
                            using (var fill = new SolidBrush(C(26, "#c9a55c"))) g.FillPath(fill, path);
                            using (var b = Pen(166, "#c9a55c", 1.6f)) g.DrawPath(b, path);
                            using (var br = new SolidBrush(C(255, "#f2d98e")))
                                g.DrawString(label, chipFont, br, chipX + 24, chipY + 8);
                        }
                        else
                        {
                            using (var fill = new SolidBrush(C(13, "#ffffff"))) g.FillPath(fill, path);
                            using (var b = Pen(72, "#e8e6e1", 1.3f)) g.DrawPath(b, path);
                            using (var br = new SolidBrush(C(255, "#e8e6e1")))
                                g.DrawString(label, chipFont, br, chipX + 24, chipY + 8);
                        }
                    }
                    chipX += cW + gap;
                }
            }

            // footer
            using (var ff = new Font("Microsoft YaHei", 20f))
            using (var fBrush = new SolidBrush(C(255, "#8fa3b8")))
                g.DrawString(foot, ff, fBrush, 120, 588);

            bmp.Save(outPath, System.Drawing.Imaging.ImageFormat.Png);
        }
    }

    private static void Glow(Graphics g, float cx, float cy, float r, int a, string hex)
    {
        using (var path = new GraphicsPath())
        {
            path.AddEllipse(cx - r, cy - r, r * 2, r * 2);
            using (var pb = new PathGradientBrush(path))
            {
                pb.CenterColor = C(a, hex);
                pb.SurroundColors = new Color[] { C(0, hex) };
                g.FillPath(pb, path);
            }
        }
    }

    private static void Ring(Graphics g, float x, float y, float d, int a, string hex, float w)
    {
        using (var p = Pen(a, hex, w)) g.DrawEllipse(p, x, y, d, d);
    }

    private static void Hex(Graphics g, float cx, float cy, float size, int a, string hex, float rot)
    {
        var pts = new PointF[6];
        for (int i = 0; i < 6; i++)
        {
            double ang = (i * 60 - 30 + rot) * Math.PI / 180;
            pts[i] = new PointF(cx + size * (float)Math.Cos(ang), cy + size * (float)Math.Sin(ang));
        }
        using (var path = new GraphicsPath())
        {
            path.AddPolygon(pts);
            using (var br = new SolidBrush(C(a, hex))) g.FillPath(br, path);
        }
    }

    private static void Card(Graphics g, float x, float y, string k, string v, string vHex)
    {
        float w = 290, h = 108, r = 16;
        using (var path = new GraphicsPath())
        {
            path.AddArc(x, y, r * 2, r * 2, 180, 90);
            path.AddArc(x + w - r * 2, y, r * 2, r * 2, 270, 90);
            path.AddArc(x + w - r * 2, y + h - r * 2, r * 2, r * 2, 0, 90);
            path.AddArc(x, y + h - r * 2, r * 2, r * 2, 90, 90);
            path.CloseFigure();
            using (var fill = new SolidBrush(C(34, "#ffffff"))) g.FillPath(fill, path);
            using (var b = Pen(40, "#e8e6e1", 1.2f)) g.DrawPath(b, path);
        }
        using (var kf = new Font("Microsoft YaHei", 16f))
        using (var kbr = new SolidBrush(C(255, "#8b93a3")))
            g.DrawString(k, kf, kbr, x + 24, y + 16);
        using (var vf = new Font("Microsoft YaHei", 30f, FontStyle.Bold))
        using (var vbr = new SolidBrush(ColorTranslator.FromHtml(vHex)))
            g.DrawString(v, vf, vbr, x + 24, y + 50);
    }
}
"@ -ReferencedAssemblies System.Drawing

[BannerGen]::Run('E:\zzz_HP\tmp-banner-texts.json', 'E:\zzz_HP\banner-2560x640.png')
Write-Output 'done'
