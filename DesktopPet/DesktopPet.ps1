Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

# Windows 默认把 PowerShell 当成 DPI 不感知的程序：在 125% / 150% 缩放下，
# 系统会把整个宠物窗口拉伸放大，描边和眼睛因此发虚、颜色变灰。
# 在创建任何窗口之前声明 Per-Monitor V2，让它按物理像素绘制。
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DesktopPuppyDpi
{
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

    public static void Enable()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { }
        try { if (SetProcessDpiAwareness(2) == 0) return; } catch { }
        try { SetProcessDPIAware(); } catch { }
    }
}
'@
try { [DesktopPuppyDpi]::Enable() } catch { }

$imagePath = Join-Path $PSScriptRoot 'DesktopPuppy-final.png'
if (-not (Test-Path -LiteralPath $imagePath)) {
    $imagePath = Join-Path $PSScriptRoot 'DesktopPuppy.png'
}
if (-not (Test-Path -LiteralPath $imagePath)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Desktop pet image not found.`nPlace DesktopPuppy-final.png next to this script.",
        'Desktop Puppy',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    exit 1
}
$env:DESKTOP_PUPPY_IMAGE = $imagePath

# Remember the pet's position and size between launches.
$settingsRoot = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($settingsRoot)) { $settingsRoot = $PSScriptRoot }
$settingsDir = Join-Path $settingsRoot 'DesktopPuppy'
$env:DESKTOP_PUPPY_SETTINGS = Join-Path $settingsDir 'settings.ini'

$source = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public sealed class DesktopPuppy : Form
{
    private enum Pose
    {
        Sit, Walk, Sleep, Sniff, Shades, Flower, Wave, Stretch, Rose, Dance
    }

    private const int BaseWidth = 280;
    private const int BaseHeight = 300;
    private const float DefaultScale = 0.6f;
    private const int BlinkDurationTicks = 12;
    private const int GlowRadius = 2;
    private const int GlowPadding = 10;
    private const int WM_NCHITTEST = 0x0084;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int ULW_ALPHA = 0x00000002;
    private static readonly Color KeyColor = Color.FromArgb(1, 2, 3);
    private static System.Threading.Mutex instanceMutex;

    private readonly Timer timer = new Timer();
    private readonly Random random = new Random();
    private readonly Bitmap character;
    private readonly string settingsPath;
    private readonly bool ownsMutex;
    private Pose pose = Pose.Sit;
    private float phase;
    private float direction = -1;
    private float walkSpeed;
    private float walkTarget;
    private float subpixelX;
    private int actionTicks;
    private int blinkTicks;
    private int nextBlink;
    private float userScale = DefaultScale;
    private float sizeScale = DefaultScale;
    private readonly float dpiScale = 1f;
    private bool dragging;
    private bool dragged;
    private bool poseHeld;
    private float featureEyeLeftX;
    private float featureEyeRightX;
    private float featureEyeLeftY;
    private float featureEyeRightY;
    private Point mouseOrigin;
    private Point formOrigin;

    // 逐像素 Alpha 分层窗口：整帧先画到内存位图，再交给 UpdateLayeredWindow，
    // 这样白边和柔光才是真正的半透明，不会被颜色键弄成灰边。
    private Bitmap frameBitmap;
    private Bitmap glowBitmap;
    private Bitmap spriteCharacter;
    private Bitmap spriteGlow;
    private float spriteScale = -1f;
    private byte[] framePixels;
    private IntPtr memoryDc = IntPtr.Zero;
    private IntPtr dibSection = IntPtr.Zero;
    private IntPtr originalDib = IntPtr.Zero;
    private IntPtr dibBits = IntPtr.Zero;
    private int surfaceWidth;
    private int surfaceHeight;

    public DesktopPuppy()
    {
        bool created;
        instanceMutex = new System.Threading.Mutex(true, "Local\\DesktopPuppyOriginalDog", out created);
        ownsMutex = created;

        // 进程已声明 DPI 感知，这里取系统 DPI（96 / 120 / 144 ...），
        // 让宠物在 125%、150% 缩放下仍保持同样的物理大小。
        using (Graphics screen = Graphics.FromHwnd(IntPtr.Zero))
            dpiScale = screen.DpiX / 96f;
        if (dpiScale < 0.9f || dpiScale > 4f) dpiScale = 1f;

        string imagePath = Environment.GetEnvironmentVariable("DESKTOP_PUPPY_IMAGE");
        if (String.IsNullOrEmpty(imagePath) || !File.Exists(imagePath))
            throw new FileNotFoundException("The desktop puppy image could not be found.", imagePath);
        using (var loaded = new Bitmap(imagePath))
            character = new Bitmap(loaded);
        SanitizeKeyColor(character);
        ConfigureFeatures();
        glowBitmap = BuildGlow(character, GlowRadius, GlowPadding, 0.92f);

        settingsPath = Environment.GetEnvironmentVariable("DESKTOP_PUPPY_SETTINGS");
        if (String.IsNullOrEmpty(settingsPath))
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DesktopPuppy");
            settingsPath = Path.Combine(dir, "settings.ini");
        }

        Text = "Desktop Puppy";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        AutoScaleMode = AutoScaleMode.None;
        Cursor = Cursors.Hand;
        BackColor = KeyColor;
        ClientSize = new Size(BaseWidth, BaseHeight);
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer, true);

        ApplyScale(DefaultScale);
        LoadSettings();
        actionTicks = random.Next(360, 680);
        nextBlink = random.Next(75, 170);

        var menu = new ContextMenuStrip();
        menu.ShowImageMargin = false;
        menu.Items.Add("\u5750\u4e0b\u966a\u4f60", null, delegate { HoldPose(Pose.Sit); });
        menu.Items.Add("\u6253\u4e2a\u76f9", null, delegate { HoldPose(Pose.Sleep); });

        var actionMenu = new ToolStripMenuItem("\u66f4\u591a\u52a8\u4f5c");
        actionMenu.DropDownItems.Add("\u968f\u673a\u6563\u6b65", null, delegate { BeginWalk(); });
        actionMenu.DropDownItems.Add("\u55c5\u4e00\u55c5", null, delegate { StartTrick(Pose.Sniff); });
        actionMenu.DropDownItems.Add("\u6234\u58a8\u955c", null, delegate { StartTrick(Pose.Shades); });
        actionMenu.DropDownItems.Add("\u53fc\u5c0f\u82b1", null, delegate { StartTrick(Pose.Flower); });
        actionMenu.DropDownItems.Add("\u6325\u722a", null, delegate { StartTrick(Pose.Wave); });
        actionMenu.DropDownItems.Add("\u4f38\u61d2\u8170", null, delegate { StartTrick(Pose.Stretch); });
        actionMenu.DropDownItems.Add("\u9001\u6735\u5c0f\u82b1", null, delegate { StartTrick(Pose.Rose); });
        actionMenu.DropDownItems.Add("\u8df3\u4e2a\u821e", null, delegate { StartTrick(Pose.Dance); });
        menu.Items.Add(actionMenu);

        var sizeMenu = new ToolStripMenuItem("\u8c03\u6574\u5927\u5c0f");
        sizeMenu.DropDownItems.Add("\u7f29\u5c0f 10%", null, delegate { SetSize(userScale - 0.1f); });
        sizeMenu.DropDownItems.Add("\u653e\u5927 10%", null, delegate { SetSize(userScale + 0.1f); });
        sizeMenu.DropDownItems.Add(new ToolStripSeparator());
        sizeMenu.DropDownItems.Add("\u6062\u590d\u9ed8\u8ba4\uff0860%\uff09", null, delegate { SetSize(DefaultScale); });
        menu.Items.Add(sizeMenu);

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("\u9000\u51fa", null, delegate { Close(); });
        ContextMenuStrip = menu;

        if (!ownsMutex)
        {
            Shown += delegate { Close(); };
            return;
        }

        timer.Interval = 33;
        timer.Tick += Animate;
        timer.Start();
    }

    private void ConfigureFeatures()
    {
        // Positions are fractions of the loaded artwork, so the accessories and
        // blink mask follow the image even after the pet asset is replaced.
        featureEyeLeftX = character.Width * 0.3662f;
        featureEyeRightX = character.Width * 0.6122f;
        featureEyeLeftY = character.Height * 0.5155f;
        featureEyeRightY = character.Height * 0.5108f;
    }

    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_LAYERED;
            return cp;
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeSize
    {
        public int Width;
        public int Height;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BlendFunction
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader
    {
        public uint Size;
        public int Width;
        public int Height;
        public ushort Planes;
        public ushort BitCount;
        public uint Compression;
        public uint SizeImage;
        public int XPelsPerMeter;
        public int YPelsPerMeter;
        public uint ClrUsed;
        public uint ClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfo
    {
        public BitmapInfoHeader Header;
        public uint Colors;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hDc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hDc);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hDc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateDIBSection(
        IntPtr hDc, ref BitmapInfo info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("user32.dll")] private static extern bool UpdateLayeredWindow(
        IntPtr hWnd, IntPtr destDc, ref NativePoint destPoint, ref NativeSize size,
        IntPtr srcDc, ref NativePoint srcPoint, int colorKey, ref BlendFunction blend, int flags);

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (!ownsMutex) return;
        SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040);
        RenderFrame();
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_NCHITTEST && !dragging)
        {
            long lParam = m.LParam.ToInt64();
            int screenX = (short)(lParam & 0xffff);
            int screenY = (short)((lParam >> 16) & 0xffff);
            if (!IsOverCharacter(new Point(screenX, screenY)))
            {
                // Let the desktop and windows underneath receive the click.
                m.Result = new IntPtr(-1);
                return;
            }
        }
        base.WndProc(ref m);
    }

    private bool IsOverCharacter(Point screenPoint)
    {
        if (!Visible || WindowState == FormWindowState.Minimized) return false;

        Point client = PointToClient(screenPoint);
        if (client.X < 0 || client.Y < 0 ||
            client.X >= ClientSize.Width || client.Y >= ClientSize.Height)
            return false;

        float logicalX = client.X / sizeScale;
        float logicalY = client.Y / sizeScale;

        // The drawing is mirrored when walking to the right.
        if (direction > 0) logicalX = BaseWidth - logicalX;
        logicalX -= GetSway();
        logicalY += GetBounce() + GetIdleBob();

        float width = 242f;
        float height = width * character.Height / character.Width;
        float x = (BaseWidth - width) / 2f;
        float y = BaseHeight - height - 4f;

        // Undo the small extra transforms used by the playful poses.
        if (pose == Pose.Stretch)
        {
            float bottom = y + height;
            logicalX = 140f + (logicalX - 140f) / 1.015f;
            logicalY = bottom + (logicalY - bottom) / 0.985f;
        }

        if (logicalX < x || logicalX > x + width || logicalY < y || logicalY > y + height)
            return false;

        int sourceX = (int)((logicalX - x) / width * character.Width);
        int sourceY = (int)((logicalY - y) / height * character.Height);
        sourceX = Math.Max(0, Math.Min(character.Width - 1, sourceX));
        sourceY = Math.Max(0, Math.Min(character.Height - 1, sourceY));
        return character.GetPixel(sourceX, sourceY).A >= 20;
    }

    private void LoadSettings()
    {
        bool hasPosition = false;
        bool dpiAwareSettings = false;
        int savedX = 0;
        int savedY = 0;

        try
        {
            if (File.Exists(settingsPath))
            {
                var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (string line in File.ReadAllLines(settingsPath))
                {
                    if (String.IsNullOrWhiteSpace(line) || line.TrimStart().StartsWith("#")) continue;
                    int equals = line.IndexOf('=');
                    if (equals <= 0) continue;
                    values[line.Substring(0, equals).Trim()] = line.Substring(equals + 1).Trim();
                }

                string value;
                float savedScale;
                if (values.TryGetValue("scale", out value) &&
                    float.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out savedScale))
                {
                    ApplyScale(savedScale);
                }

                int x;
                int y;
                if (values.TryGetValue("x", out value) &&
                    int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out x) &&
                    values.TryGetValue("y", out value) &&
                    int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out y))
                {
                    hasPosition = true;
                    savedX = x;
                    savedY = y;
                }

                string marker;
                dpiAwareSettings = values.TryGetValue("dpiAware", out marker) && marker == "1";
            }
        }
        catch
        {
            // A damaged settings file should never prevent the pet from starting.
        }

        if (hasPosition)
        {
            // 旧版本以“虚拟像素”保存坐标（系统会替它放大 125%），
            // 现在按物理像素定位，需要把旧坐标换算一次。
            if (!dpiAwareSettings)
            {
                savedX = (int)Math.Round(savedX * dpiScale);
                savedY = (int)Math.Round(savedY * dpiScale);
            }

            Rectangle work = Screen.FromPoint(
                new Point(savedX + Width / 2, savedY + Height / 2)).WorkingArea;
            int x = Math.Min(Math.Max(savedX, work.Left), Math.Max(work.Left, work.Right - Width));
            int y = Math.Min(Math.Max(savedY, work.Top), Math.Max(work.Top, work.Bottom - Height));
            Location = new Point(x, y);
        }
        else
        {
            SetDefaultLocation();
        }
    }

    private void SaveSettings()
    {
        if (!ownsMutex) return;
        try
        {
            string directory = Path.GetDirectoryName(settingsPath);
            if (!String.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                Directory.CreateDirectory(directory);

            string[] lines =
            {
                "# DesktopPuppy settings",
                "x=" + Left.ToString(CultureInfo.InvariantCulture),
                "y=" + Top.ToString(CultureInfo.InvariantCulture),
                "scale=" + userScale.ToString("0.###", CultureInfo.InvariantCulture),
                "dpiAware=1"
            };
            File.WriteAllLines(settingsPath, lines, Encoding.UTF8);
        }
        catch
        {
            // Ignore read-only or otherwise unavailable settings locations.
        }
    }

    private void SetDefaultLocation()
    {
        Rectangle work = Screen.PrimaryScreen.WorkingArea;
        int x = work.Right - Width - 24;
        int y = work.Bottom - Height - 8;
        Location = new Point(Math.Max(work.Left, x), Math.Max(work.Top, y));
    }

    private void ApplyScale(float scale)
    {
        userScale = Math.Max(0.4f, Math.Min(1.6f, scale));
        sizeScale = userScale * dpiScale;
        ClientSize = new Size(
            (int)Math.Round(BaseWidth * sizeScale),
            (int)Math.Round(BaseHeight * sizeScale));
    }

    private void SetSize(float scale)
    {
        Rectangle work = Screen.FromControl(this).WorkingArea;
        int right = Right;
        int bottom = Bottom;
        ApplyScale(scale);
        int x = Math.Max(work.Left, Math.Min(work.Right - Width, right - Width));
        int y = Math.Max(work.Top, Math.Min(work.Bottom - Height, bottom - Height));
        Location = new Point(x, y);
        SaveSettings();
        RenderFrame();
    }

    private void SetPose(Pose next, int duration)
    {
        pose = next;
        phase = 0;
        actionTicks = duration;
        poseHeld = false;
        if (next != Pose.Walk)
        {
            walkTarget = 0;
            subpixelX = Left;
        }
        RenderFrame();
    }

    // Sit / nap picked from the menu stay until the next menu pick or click,
    // unlike the short poses the pet picks for itself.
    private void HoldPose(Pose next)
    {
        SetPose(next, 0);
        poseHeld = true;
    }

    private void BeginWalk()
    {
        Rectangle area = Screen.FromControl(this).WorkingArea;
        if (Left <= area.Left + 8) direction = 1;
        else if (Right >= area.Right - 8) direction = -1;
        else direction = random.Next(2) == 0 ? -1 : 1;
        walkTarget = random.Next(85, 191);
        walkSpeed = 0;
        subpixelX = Left;
        SetPose(Pose.Walk, 1);
    }

    private static readonly Pose[] TrickPoses =
    {
        Pose.Sniff, Pose.Shades, Pose.Flower, Pose.Wave,
        Pose.Stretch, Pose.Rose, Pose.Dance
    };

    private void StartTrick(Pose trick)
    {
        SetPose(trick, DurationFor(trick));
    }

    private void PickTrick()
    {
        Pose pick = TrickPoses[random.Next(TrickPoses.Length)];
        SetPose(pick, DurationFor(pick));
    }

    private int DurationFor(Pose action)
    {
        if (action == Pose.Rose) return random.Next(230, 320);
        if (action == Pose.Dance) return random.Next(250, 340);
        return random.Next(95, 155);
    }

    private void Animate(object sender, EventArgs e)
    {
        phase += pose == Pose.Sleep ? 0.045f : 0.12f;

        if (pose == Pose.Walk)
        {
            float desiredSpeed = walkTarget < 38 ? walkTarget / 38f * 1.1f : 1.1f;
            walkSpeed += (desiredSpeed - walkSpeed) * 0.08f;
            float step = walkSpeed * direction;
            subpixelX += step;
            Left = (int)Math.Round(subpixelX);
            walkTarget -= Math.Abs(step);

            Rectangle area = Screen.FromControl(this).WorkingArea;
            if (Left <= area.Left)
            {
                Left = area.Left;
                direction = 1;
                subpixelX = Left;
            }
            else if (Right >= area.Right)
            {
                Left = area.Right - Width;
                direction = -1;
                subpixelX = Left;
            }
            if (walkTarget <= 0) SetPose(Pose.Sit, random.Next(360, 680));
        }
        else if (!poseHeld && --actionTicks <= 0)
        {
            if (pose != Pose.Sit)
            {
                SetPose(Pose.Sit, random.Next(360, 680));
            }
            else
            {
                int next = random.Next(100);
                if (next < 24) BeginWalk();
                else if (next < 39) SetPose(Pose.Sleep, random.Next(220, 360));
                else PickTrick();
            }
        }

        if (blinkTicks > 0) blinkTicks--;
        else if (--nextBlink <= 0)
        {
            blinkTicks = BlinkDurationTicks;
            nextBlink = random.Next(75, 170);
        }
        RenderFrame();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        // 画面由 RenderFrame 推送到分层窗口，普通 WM_PAINT 不再绘制。
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
    }

    private void RenderFrame()
    {
        if (!IsHandleCreated) return;
        int width = ClientSize.Width;
        int height = ClientSize.Height;
        if (width <= 0 || height <= 0) return;

        EnsureFrame(width, height);
        EnsureSprites();

        using (Graphics g = Graphics.FromImage(frameBitmap))
        {
            g.Clear(Color.Transparent);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.ScaleTransform(sizeScale, sizeScale);

            g.TranslateTransform(0, -GetBounce() - GetIdleBob());
            if (direction > 0)
            {
                g.TranslateTransform(BaseWidth, 0);
                g.ScaleTransform(-1, 1);
            }
            g.TranslateTransform(GetSway(), 0);
            DrawCharacter(g);
        }

        PresentFrame(width, height);
    }

    private void EnsureFrame(int width, int height)
    {
        if (frameBitmap == null || frameBitmap.Width != width || frameBitmap.Height != height)
        {
            if (frameBitmap != null) frameBitmap.Dispose();
            frameBitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            framePixels = new byte[width * height * 4];
        }
        EnsureSurface(width, height);
    }

    // 把素材预先缩放到实际显示尺寸，避免每帧都对 700px 的图做双三次采样。
    private void EnsureSprites()
    {
        if (spriteCharacter != null && Math.Abs(spriteScale - sizeScale) < 0.0005f) return;

        if (spriteCharacter != null) spriteCharacter.Dispose();
        if (spriteGlow != null) spriteGlow.Dispose();
        spriteCharacter = null;
        spriteGlow = null;

        float width = 242f * sizeScale;
        int pixelWidth = Math.Max(1, (int)Math.Round(width));
        int pixelHeight = Math.Max(1, (int)Math.Round(width * character.Height / character.Width));
        spriteCharacter = ResizeHighQuality(character, pixelWidth, pixelHeight);

        if (glowBitmap != null)
        {
            float pad = GlowPadding * (width / character.Width);
            int glowWidth = Math.Max(1, (int)Math.Round((width + pad * 2f)));
            int glowHeight = Math.Max(1, (int)Math.Round(
                (width * character.Height / character.Width + pad * 2f)));
            spriteGlow = ResizeHighQuality(glowBitmap, glowWidth, glowHeight);
        }

        spriteScale = sizeScale;
    }

    private static Bitmap ResizeHighQuality(Bitmap source, int width, int height)
    {
        var result = new Bitmap(width, height, PixelFormat.Format32bppPArgb);
        using (Graphics g = Graphics.FromImage(result))
        {
            g.Clear(Color.Transparent);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.DrawImage(source, new Rectangle(0, 0, width, height));
        }
        return result;
    }

    private void EnsureSurface(int width, int height)
    {
        if (memoryDc != IntPtr.Zero && surfaceWidth == width && surfaceHeight == height) return;
        ReleaseSurface();

        IntPtr screenDc = GetDC(IntPtr.Zero);
        memoryDc = CreateCompatibleDC(screenDc);
        var info = new BitmapInfo();
        info.Header.Size = (uint)Marshal.SizeOf(typeof(BitmapInfoHeader));
        info.Header.Width = width;
        info.Header.Height = -height;
        info.Header.Planes = 1;
        info.Header.BitCount = 32;
        info.Header.Compression = 0;
        dibSection = CreateDIBSection(screenDc, ref info, 0, out dibBits, IntPtr.Zero, 0);
        originalDib = SelectObject(memoryDc, dibSection);
        surfaceWidth = width;
        surfaceHeight = height;
        ReleaseDC(IntPtr.Zero, screenDc);
    }

    private void ReleaseSurface()
    {
        if (memoryDc == IntPtr.Zero) return;
        if (originalDib != IntPtr.Zero) SelectObject(memoryDc, originalDib);
        if (dibSection != IntPtr.Zero) DeleteObject(dibSection);
        DeleteDC(memoryDc);
        memoryDc = IntPtr.Zero;
        dibSection = IntPtr.Zero;
        originalDib = IntPtr.Zero;
        dibBits = IntPtr.Zero;
        surfaceWidth = 0;
        surfaceHeight = 0;
    }

    private void PresentFrame(int width, int height)
    {
        if (memoryDc == IntPtr.Zero || dibBits == IntPtr.Zero) return;

        BitmapData data = frameBitmap.LockBits(
            new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            int stride = data.Stride;
            if (stride == width * 4)
            {
                Marshal.Copy(data.Scan0, framePixels, 0, framePixels.Length);
            }
            else
            {
                for (int y = 0; y < height; y++)
                {
                    Marshal.Copy(data.Scan0 + y * stride, framePixels, y * width * 4, width * 4);
                }
            }
        }
        finally
        {
            frameBitmap.UnlockBits(data);
        }

        // UpdateLayeredWindow 使用预乘 Alpha。
        for (int i = 0; i < framePixels.Length; i += 4)
        {
            int alpha = framePixels[i + 3];
            if (alpha == 255) continue;
            if (alpha == 0)
            {
                framePixels[i] = 0;
                framePixels[i + 1] = 0;
                framePixels[i + 2] = 0;
                continue;
            }
            framePixels[i] = (byte)(framePixels[i] * alpha / 255);
            framePixels[i + 1] = (byte)(framePixels[i + 1] * alpha / 255);
            framePixels[i + 2] = (byte)(framePixels[i + 2] * alpha / 255);
        }

        Marshal.Copy(framePixels, 0, dibBits, framePixels.Length);

        IntPtr screenDc = GetDC(IntPtr.Zero);
        var destination = new NativePoint { X = Left, Y = Top };
        var size = new NativeSize { Width = width, Height = height };
        var source = new NativePoint { X = 0, Y = 0 };
        var blend = new BlendFunction
        {
            BlendOp = 0,
            BlendFlags = 0,
            SourceConstantAlpha = 255,
            AlphaFormat = 1
        };
        UpdateLayeredWindow(Handle, screenDc, ref destination, ref size, memoryDc,
            ref source, 0, ref blend, ULW_ALPHA);
        ReleaseDC(IntPtr.Zero, screenDc);
    }

    // 用角色图的 Alpha 做轮廓，模糊后铺成白色柔光，效果等同网页的
    // filter: drop-shadow(0 0 0.6px rgba(255,255,255,.95))。
    private static Bitmap BuildGlow(Bitmap source, int radius, int padding, float strength)
    {
        int width = source.Width + padding * 2;
        int height = source.Height + padding * 2;
        byte[] mask = new byte[width * height];

        BitmapData data = source.LockBits(
            new Rectangle(0, 0, source.Width, source.Height),
            ImageLockMode.ReadOnly,
            PixelFormat.Format32bppArgb);
        try
        {
            int stride = data.Stride;
            byte[] row = new byte[stride];
            for (int y = 0; y < source.Height; y++)
            {
                Marshal.Copy(data.Scan0 + y * stride, row, 0, stride);
                int target = (y + padding) * width + padding;
                for (int x = 0; x < source.Width; x++)
                {
                    mask[target + x] = row[x * 4 + 3];
                }
            }
        }
        finally
        {
            source.UnlockBits(data);
        }

        for (int pass = 0; pass < 3; pass++)
        {
            mask = BoxBlur(mask, width, height, radius);
        }

        Bitmap glow = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        BitmapData glowData = glow.LockBits(
            new Rectangle(0, 0, width, height),
            ImageLockMode.WriteOnly,
            PixelFormat.Format32bppArgb);
        try
        {
            int stride = glowData.Stride;
            byte[] row = new byte[stride];
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    int alpha = (int)(mask[y * width + x] * strength);
                    if (alpha > 255) alpha = 255;
                    int offset = x * 4;
                    row[offset] = 255;
                    row[offset + 1] = 255;
                    row[offset + 2] = 255;
                    row[offset + 3] = (byte)alpha;
                }
                Marshal.Copy(row, 0, glowData.Scan0 + y * stride, stride);
            }
        }
        finally
        {
            glow.UnlockBits(glowData);
        }

        return glow;
    }

    private static byte[] BoxBlur(byte[] source, int width, int height, int radius)
    {
        byte[] horizontal = new byte[source.Length];
        byte[] result = new byte[source.Length];
        int window = radius * 2 + 1;

        for (int y = 0; y < height; y++)
        {
            int row = y * width;
            int sum = 0;
            for (int offset = -radius; offset <= radius; offset++)
            {
                int x = Math.Max(0, Math.Min(width - 1, offset));
                sum += source[row + x];
            }
            for (int x = 0; x < width; x++)
            {
                horizontal[row + x] = (byte)(sum / window);
                int add = Math.Min(width - 1, x + radius + 1);
                int remove = Math.Max(0, x - radius);
                sum += source[row + add] - source[row + remove];
            }
        }

        for (int x = 0; x < width; x++)
        {
            int sum = 0;
            for (int offset = -radius; offset <= radius; offset++)
            {
                int y = Math.Max(0, Math.Min(height - 1, offset));
                sum += horizontal[y * width + x];
            }
            for (int y = 0; y < height; y++)
            {
                result[y * width + x] = (byte)(sum / window);
                int add = Math.Min(height - 1, y + radius + 1);
                int remove = Math.Max(0, y - radius);
                sum += horizontal[add * width + x] - horizontal[remove * width + x];
            }
        }

        return result;
    }

    private float GetBounce()
    {
        if (pose == Pose.Walk) return (float)Math.Abs(Math.Sin(phase * 2)) * 2;
        if (pose == Pose.Sleep) return (float)Math.Sin(phase) * 1.2f;
        if (pose == Pose.Stretch) return (float)Math.Sin(phase) * 2;
        if (pose == Pose.Rose) return (float)Math.Sin(phase * 1.1f) * 1.2f;
        if (pose == Pose.Dance) return (float)Math.Abs(Math.Sin(phase * 2.2f)) * 4;
        return 0;
    }

    private float GetIdleBob()
    {
        if (pose == Pose.Sit || pose == Pose.Sniff || pose == Pose.Shades ||
            pose == Pose.Flower || pose == Pose.Wave)
            return (float)Math.Sin(phase * 1.25f) * 0.8f;
        return 0;
    }

    private float GetSway()
    {
        if (pose == Pose.Dance) return (float)Math.Sin(phase * 1.9f) * 4f;
        return 0;
    }

    private void DrawCharacter(Graphics g)
    {
        float width = 242f;
        float height = width * character.Height / character.Width;
        float x = (BaseWidth - width) / 2f;
        float y = BaseHeight - height - 4f;
        RectangleF destination = new RectangleF(x, y, width, height);

        GraphicsState drawingState = g.Save();
        if (pose == Pose.Stretch)
        {
            g.TranslateTransform(140, y + height);
            g.ScaleTransform(1.015f, 0.985f);
            g.TranslateTransform(-140, -(y + height));
        }

        if (spriteGlow != null)
        {
            float pad = GlowPadding * (width / character.Width);
            g.DrawImage(spriteGlow, new RectangleF(
                x - pad, y - pad, width + pad * 2f, height + pad * 2f));
        }

        g.DrawImage(spriteCharacter != null ? spriteCharacter : character, destination);
        g.Restore(drawingState);
        DrawTrackedEyes(g, x, y, width, height);

        bool wearingSunglasses = pose == Pose.Shades;
        if (wearingSunglasses) DrawSunglasses(g, x, y, width, height);
        if (pose == Pose.Flower) DrawFlower(g, x, y, width, height);
        if (pose == Pose.Sniff) DrawSniffMarks(g, x, y, width, height);
        if (pose == Pose.Stretch) DrawStretchMarks(g);
        if (pose == Pose.Wave) DrawWaveMarks(g);
        if (pose == Pose.Rose) DrawRose(g, x, y, width, height);
        if (pose == Pose.Dance) DrawDanceNotes(g, x, y, width, height);
        if (!wearingSunglasses && (blinkTicks > 0 || pose == Pose.Sleep))
            DrawBlink(g, x, y, width, height, pose == Pose.Sleep);
    }

    private void DrawTrackedEyes(Graphics g, float x, float y, float width, float height)
    {
        Point cursor = PointToClient(Cursor.Position);
        float logicalX = cursor.X / sizeScale;
        float logicalY = cursor.Y / sizeScale;
        if (direction > 0) logicalX = BaseWidth - logicalX;
        logicalX -= GetSway();
        logicalY += GetBounce() + GetIdleBob();

        float sourceCursorX = (logicalX - x) / width * character.Width;
        float sourceCursorY = (logicalY - y) / height * character.Height;
        float centerX = (featureEyeLeftX + featureEyeRightX) / 2f;
        float centerY = (featureEyeLeftY + featureEyeRightY) / 2f;
        float lookX = sourceCursorX - centerX;
        float lookY = sourceCursorY - centerY;
        float length = (float)Math.Sqrt(lookX * lookX + lookY * lookY);
        if (length > 0.001f)
        {
            lookX /= length;
            lookY /= length;
        }
        else
        {
            lookX = 0;
            lookY = 0;
        }

        // 与网页版桌宠同一套比例：眼白 7% × 9.6%，瞳孔为眼白的 60%。
        // 旧版瞳孔只有 3.8% × 5.4%，几乎和原图眼睛一样大，边缘糊边会露出来，
        // 看起来就比网页版小一号、发灰。
        float offsetX = lookX * character.Width * 0.015f;
        float offsetY = lookY * character.Width * 0.015f;
        float patchWidth = width * 0.070f;
        float patchHeight = height * 0.096f;
        float eyeWidth = width * 0.042f;
        float eyeHeight = height * 0.0576f;
        float offsetDrawX = offsetX * (width / character.Width);
        float offsetDrawY = offsetY * (height / character.Height);

        using (var white = new SolidBrush(Color.White))
        using (var eye = new SolidBrush(Color.FromArgb(12, 11, 10)))
        {
            float[] eyeXs = { x + featureEyeLeftX * (width / character.Width),
                              x + featureEyeRightX * (width / character.Width) };
            float[] eyeYs = { y + featureEyeLeftY * (height / character.Height),
                              y + featureEyeRightY * (height / character.Height) };
            for (int i = 0; i < eyeXs.Length; i++)
            {
                float eyeX = eyeXs[i];
                float eyeY = eyeYs[i];
                g.FillEllipse(white, eyeX - patchWidth / 2f, eyeY - patchHeight / 2f,
                    patchWidth, patchHeight);
                g.FillEllipse(eye,
                    eyeX + offsetDrawX - eyeWidth / 2f,
                    eyeY + offsetDrawY - eyeHeight / 2f,
                    eyeWidth, eyeHeight);
            }
        }
    }

    private void DrawBlink(Graphics g, float x, float y, float width, float height, bool heldClosed)
    {
        float progress = 1f - blinkTicks / (float)BlinkDurationTicks;
        float openness = (float)Math.Abs(Math.Cos(progress * Math.PI));
        if (!heldClosed && openness > 0.97f) return;

        float scaleX = width / character.Width;
        float scaleY = height / character.Height;
        float patchWidth = width * 0.070f;
        float patchHeight = height * 0.096f;
        float lidHalf = character.Width * 0.024f * scaleX;
        float lidDrop = character.Height * 0.017f * scaleY;
        using (var white = new SolidBrush(Color.White))
        using (var eye = new SolidBrush(Color.FromArgb(12, 11, 10)))
        using (var line = new Pen(Color.FromArgb(12, 11, 10), 2.2f))
        {
            line.StartCap = LineCap.Round;
            line.EndCap = LineCap.Round;
            float[] eyeXs = { x + featureEyeLeftX * scaleX, x + featureEyeRightX * scaleX };
            float[] eyeYs = { y + featureEyeLeftY * scaleY, y + featureEyeRightY * scaleY };
            for (int i = 0; i < eyeXs.Length; i++)
            {
                float eyeX = eyeXs[i];
                float eyeY = eyeYs[i];
                g.FillEllipse(white, eyeX - patchWidth / 2f, eyeY - patchHeight / 2f,
                    patchWidth, patchHeight);
                if (heldClosed || openness < 0.08f)
                {
                    using (var closedLid = new GraphicsPath())
                    {
                        closedLid.AddBezier(eyeX - lidHalf, eyeY,
                            eyeX - lidHalf * 0.55f, eyeY + lidDrop,
                            eyeX + lidHalf * 0.55f, eyeY + lidDrop,
                            eyeX + lidHalf, eyeY);
                        g.DrawPath(line, closedLid);
                    }
                }
                else
                {
                    float eyeHeight = height * 0.0576f * openness;
                    float eyeWidth = width * 0.042f;
                    g.FillEllipse(eye, eyeX - eyeWidth / 2f, eyeY - eyeHeight / 2f,
                        eyeWidth, eyeHeight);
                }
            }
        }
    }

    private void DrawSunglasses(Graphics g, float x, float y, float width, float height)
    {
        float scaleX = width / character.Width;
        float scaleY = height / character.Height;
        GraphicsState state = g.Save();
        g.TranslateTransform(x, y);
        g.ScaleTransform(scaleX, scaleY);
        g.SmoothingMode = SmoothingMode.AntiAlias;

        float lensWidth = character.Width * 0.165f;
        float lensHeight = character.Height * 0.100f;
        float centerY = (featureEyeLeftY + featureEyeRightY) / 2f;
        float leftCenter = featureEyeLeftX;
        float rightCenter = featureEyeRightX;

        using (var frame = new SolidBrush(Color.FromArgb(247, 214, 108)))
        using (var frameShade = new SolidBrush(Color.FromArgb(218, 179, 85)))
        using (var lens = new SolidBrush(Color.FromArgb(57, 54, 55)))
        using (var dark = new SolidBrush(Color.FromArgb(58, 48, 40)))
        using (var edge = new Pen(Color.FromArgb(58, 48, 40), 3f))
        using (var armEdge = new Pen(Color.FromArgb(58, 48, 40), 11f))
        using (var armFill = new Pen(Color.FromArgb(247, 214, 108), 6f))
        {
            float leftLens = leftCenter - lensWidth / 2f;
            float rightLens = rightCenter - lensWidth / 2f;
            float top = centerY - lensHeight / 2f;

            // Side arms first, so the frames sit on top of them.
            g.DrawLine(armEdge, leftLens + 12, centerY - 2,
                leftLens - 24, centerY - 12);
            g.DrawLine(armFill, leftLens + 12, centerY - 2,
                leftLens - 24, centerY - 12);
            g.DrawLine(armEdge, rightLens + lensWidth - 12, centerY - 2,
                rightLens + lensWidth + 24, centerY - 12);
            g.DrawLine(armFill, rightLens + lensWidth - 12, centerY - 2,
                rightLens + lensWidth + 24, centerY - 12);

            DrawSunnyLens(g, leftCenter, centerY, lensWidth, lensHeight,
                frame, lens, edge);
            DrawSunnyLens(g, rightCenter, centerY, lensWidth, lensHeight,
                frame, lens, edge);

            float bridgeLeft = leftLens + lensWidth - 3;
            float bridgeRight = rightLens + 3;
            RectangleF bridgeRect = new RectangleF(
                bridgeLeft, centerY - 11, bridgeRight - bridgeLeft, 22);
            using (GraphicsPath bridge = RoundedRect(bridgeRect, 9f))
            {
                g.FillPath(frameShade, bridge);
                g.DrawPath(edge, bridge);
            }
            g.FillRectangle(dark, leftLens + lensWidth - 4, centerY - 4, 8, 8);
            g.FillRectangle(dark, rightLens - 4, centerY - 4, 8, 8);
        }

        g.Restore(state);
    }

    private void DrawSunnyLens(
        Graphics g, float centerX, float centerY, float width, float height,
        Brush frame, Brush lens, Pen edge)
    {
        RectangleF outer = new RectangleF(
            centerX - width / 2f, centerY - height / 2f, width, height);
        RectangleF inner = new RectangleF(
            outer.X + 7f, outer.Y + 6f, outer.Width - 14f, outer.Height - 12f);

        using (GraphicsPath outerPath = RoundedRect(outer, 23f))
        using (GraphicsPath innerPath = RoundedRect(inner, 18f))
        {
            g.FillPath(frame, outerPath);
            g.DrawPath(edge, outerPath);
            g.FillPath(lens, innerPath);

            GraphicsState lensState = g.Save();
            g.SetClip(innerPath);
            using (var glare = new Pen(Color.FromArgb(225, 247, 246, 238), 7f))
            {
                g.DrawLine(glare, inner.X + 18, inner.Y + 5,
                    inner.X + 55, inner.Y + 42);
                g.DrawLine(glare, inner.X + 36, inner.Y + 2,
                    inner.X + 73, inner.Y + 39);
            }
            g.Restore(lensState);
        }
    }

    private static GraphicsPath RoundedRect(RectangleF rect, float radius)
    {
        float diameter = radius * 2f;
        if (diameter > rect.Width) diameter = rect.Width;
        if (diameter > rect.Height) diameter = rect.Height;
        GraphicsPath path = new GraphicsPath();
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180f, 90f);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270f, 90f);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter,
            diameter, diameter, 0f, 90f);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90f, 90f);
        path.CloseFigure();
        return path;
    }

    private void DrawFlower(Graphics g, float x, float y, float width, float height)
    {
        float sx = width / character.Width;
        float sy = height / character.Height;
        float cx = x + 150 * sx;
        float cy = y + 140 * sy;
        using (var stem = new Pen(Color.FromArgb(70, 145, 83), 2.5f))
        using (var petal = new SolidBrush(Color.FromArgb(244, 194, 66)))
        using (var center = new SolidBrush(Color.FromArgb(151, 87, 52)))
        {
            g.DrawLine(stem, cx + 3, cy + 10, cx + 19, cy - 14);
            g.FillEllipse(petal, cx + 12, cy - 23, 11, 11);
            g.FillEllipse(petal, cx + 22, cy - 18, 11, 11);
            g.FillEllipse(petal, cx + 19, cy - 8, 11, 11);
            g.FillEllipse(petal, cx + 8, cy - 11, 11, 11);
            g.FillEllipse(center, cx + 16, cy - 16, 9, 9);
        }
    }

    private void DrawSniffMarks(Graphics g, float x, float y, float width, float height)
    {
        float sx = width / character.Width;
        float sy = height / character.Height;
        using (var marks = new Pen(Color.FromArgb(115, 102, 91), 2))
        {
            g.DrawArc(marks, x + 450 * sx, y + 340 * sy, 10, 7, 190, 145);
            g.DrawArc(marks, x + 465 * sx, y + 345 * sy, 10, 7, 190, 145);
        }
    }

    private void DrawStretchMarks(Graphics g)
    {
        using (var marks = new Pen(Color.FromArgb(95, 90, 85), 2))
        {
            g.DrawLine(marks, 30, 185, 21, 179);
            g.DrawLine(marks, 28, 199, 17, 199);
            g.DrawLine(marks, 32, 212, 23, 219);
        }
    }

    private void DrawWaveMarks(Graphics g)
    {
        using (var marks = new Pen(Color.FromArgb(60, 55, 50), 2))
        {
            g.DrawLine(marks, 242, 170, 250, 164);
            g.DrawLine(marks, 247, 179, 256, 178);
        }
    }

    private GraphicsState BeginCharacterSpace(
        Graphics g, float x, float y, float width, float height)
    {
        GraphicsState state = g.Save();
        g.TranslateTransform(x, y);
        g.ScaleTransform(width / character.Width, height / character.Height);
        return state;
    }

    private void DrawRose(Graphics g, float x, float y, float width, float height)
    {
        GraphicsState state = BeginCharacterSpace(g, x, y, width, height);
        float sway = (float)Math.Sin(phase * 1.35f) * 4f;
        float cx = character.Width * 0.735f + sway;
        float bloomY = character.Height * 0.535f;
        float stemBottom = character.Height * 0.660f;

        using (var stem = new Pen(Color.FromArgb(69, 143, 84), 5f))
        using (var leaf = new SolidBrush(Color.FromArgb(91, 165, 99)))
        using (var leafEdge = new Pen(Color.FromArgb(56, 113, 71), 2f))
        using (var petal = new SolidBrush(Color.FromArgb(221, 72, 92)))
        using (var petalLight = new SolidBrush(Color.FromArgb(247, 150, 163)))
        using (var bloomCenter = new SolidBrush(Color.FromArgb(147, 43, 59)))
        using (var paw = new SolidBrush(Color.FromArgb(208, 144, 103)))
        using (var outline = new Pen(Color.FromArgb(72, 55, 47), 3f))
        {
            g.DrawLine(stem, cx, bloomY + 16, cx - 8, stemBottom);
            g.FillEllipse(leaf, cx - 34, bloomY + 60, 30, 15);
            g.DrawEllipse(leafEdge, cx - 34, bloomY + 60, 30, 15);
            g.FillEllipse(leaf, cx - 8, bloomY + 88, 28, 14);
            g.DrawEllipse(leafEdge, cx - 8, bloomY + 88, 28, 14);

            g.FillEllipse(paw, cx - 31, stemBottom - 10, 46, 26);
            g.DrawEllipse(outline, cx - 31, stemBottom - 10, 46, 26);

            g.FillEllipse(petal, cx - 27, bloomY - 12, 30, 30);
            g.FillEllipse(petal, cx + 2, bloomY - 16, 30, 32);
            g.FillEllipse(petal, cx - 12, bloomY - 29, 30, 31);
            g.FillEllipse(petalLight, cx - 5, bloomY - 8, 24, 25);
            g.FillEllipse(bloomCenter, cx - 9, bloomY - 2, 17, 17);

            for (int i = 0; i < 3; i++)
            {
                float t = (phase * 0.065f + i * 0.34f) % 1f;
                float hx = cx + (i - 1) * 28 + (float)Math.Sin(phase + i) * 6f;
                float hy = bloomY - 55 - t * 95f;
                int alpha = (int)(225 * (1f - t));
                using (var heart = new SolidBrush(Color.FromArgb(alpha, 233, 108, 127)))
                    DrawHeart(g, heart, hx, hy, 17f);
            }
        }
        g.Restore(state);
    }

    private void DrawDanceNotes(Graphics g, float x, float y, float width, float height)
    {
        GraphicsState state = BeginCharacterSpace(g, x, y, width, height);
        using (var noteFont = new Font("Segoe UI Symbol", 46f, FontStyle.Bold))
        using (var pink = new SolidBrush(Color.FromArgb(220, 236, 110, 139)))
        using (var blue = new SolidBrush(Color.FromArgb(220, 104, 191, 207)))
        using (var gold = new SolidBrush(Color.FromArgb(230, 246, 199, 80)))
        {
            float bob = (float)Math.Sin(phase * 1.8f) * 9f;
            g.DrawString("\u266a", noteFont, pink,
                character.Width * 0.10f, character.Height * 0.39f + bob);
            g.DrawString("\u266b", noteFont, blue,
                character.Width * 0.82f, character.Height * 0.31f - bob);
            g.DrawString("\u266a", noteFont, gold,
                character.Width * 0.75f, character.Height * 0.56f + bob * 0.6f);

            DrawStar(g, gold, character.Width * 0.20f,
                character.Height * 0.22f + bob, 13f);
            DrawStar(g, pink, character.Width * 0.88f,
                character.Height * 0.15f - bob * 0.5f, 10f);
        }
        g.Restore(state);
    }

    private static void DrawStar(Graphics g, Brush brush, float cx, float cy, float size)
    {
        PointF[] points = new PointF[8];
        for (int i = 0; i < 8; i++)
        {
            double angle = -Math.PI / 2 + i * Math.PI / 4;
            float radius = (i % 2 == 0) ? size : size * 0.34f;
            points[i] = new PointF(
                cx + (float)Math.Cos(angle) * radius,
                cy + (float)Math.Sin(angle) * radius);
        }
        g.FillPolygon(brush, points);
    }

    private static void DrawHeart(Graphics g, Brush brush, float cx, float cy, float size)
    {
        g.FillEllipse(brush, cx - size * 0.52f, cy - size * 0.48f,
            size * 0.60f, size * 0.60f);
        g.FillEllipse(brush, cx - size * 0.08f, cy - size * 0.48f,
            size * 0.60f, size * 0.60f);
        PointF[] tip =
        {
            new PointF(cx - size * 0.52f, cy - size * 0.05f),
            new PointF(cx + size * 0.52f, cy - size * 0.05f),
            new PointF(cx, cy + size * 0.58f)
        };
        g.FillPolygon(brush, tip);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;

        if (pose == Pose.Walk)
            SetPose(Pose.Sit, random.Next(240, 480));

        dragging = true;
        dragged = false;
        mouseOrigin = Cursor.Position;
        formOrigin = Location;
        Capture = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!dragging) return;

        Point current = Cursor.Position;
        int dx = current.X - mouseOrigin.X;
        int dy = current.Y - mouseOrigin.Y;
        if (Math.Abs(dx) + Math.Abs(dy) > 4) dragged = true;
        if (dragged)
        {
            Rectangle work = Screen.FromPoint(current).WorkingArea;
            int x = Math.Max(work.Left, Math.Min(work.Right - Width, formOrigin.X + dx));
            int y = Math.Max(work.Top, Math.Min(work.Bottom - Height, formOrigin.Y + dy));
            Location = new Point(x, y);
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left) return;

        dragging = false;
        Capture = false;
        if (dragged)
        {
            subpixelX = Left;
            SaveSettings();
        }
        else
        {
            // A plain click on the dog plays a random action.
            PickTrick();
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        timer.Stop();
        timer.Dispose();
        if (ownsMutex) SaveSettings();
        ReleaseSurface();
        if (glowBitmap != null) glowBitmap.Dispose();
        if (spriteGlow != null) spriteGlow.Dispose();
        if (spriteCharacter != null) spriteCharacter.Dispose();
        if (frameBitmap != null) frameBitmap.Dispose();
        character.Dispose();
        if (ownsMutex)
        {
            instanceMutex.ReleaseMutex();
        }
        instanceMutex.Dispose();
        base.OnFormClosing(e);
    }

    private static void SanitizeKeyColor(Bitmap bitmap)
    {
        BitmapData data = bitmap.LockBits(
            new Rectangle(0, 0, bitmap.Width, bitmap.Height),
            ImageLockMode.ReadWrite,
            PixelFormat.Format32bppArgb);
        try
        {
            int stride = data.Stride;
            byte[] buffer = new byte[stride * bitmap.Height];
            Marshal.Copy(data.Scan0, buffer, 0, buffer.Length);
            for (int i = 0; i < buffer.Length; i += 4)
            {
                if (buffer[i] == KeyColor.B &&
                    buffer[i + 1] == KeyColor.G &&
                    buffer[i + 2] == KeyColor.R &&
                    buffer[i + 3] != 0)
                {
                    buffer[i] = 4;
                }
            }
            Marshal.Copy(buffer, 0, data.Scan0, buffer.Length);
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    [System.Windows.Forms.Application]::Run((New-Object DesktopPuppy))
}
catch {
    try {
        [System.Windows.Forms.MessageBox]::Show(
            "Desktop puppy failed to start:`n`n$($_.Exception.Message)",
            'Desktop Puppy',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
    catch { }
    exit 1
}

