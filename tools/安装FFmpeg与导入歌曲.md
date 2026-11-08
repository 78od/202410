# 安装 FFmpeg 并导入歌曲

导入脚本使用 FFmpeg 将歌曲统一转成 128 kbps MP3，并同步更新歌单和歌词索引。编码为有损格式；请保留无损/原始音频备份。

## 安装 FFmpeg（Windows）

### 方式一：使用 WinGet（推荐）

1. 打开 PowerShell 或 Windows Terminal。
2. 执行：

   ```powershell
   winget install --id Gyan.FFmpeg.Shared --exact
   ```

3. 安装完成后关闭并重新打开终端，让新的 PATH 生效。如果 VS Code 早于 FFmpeg 安装启动，建议重启 VS Code；导入脚本也会尝试读取 Windows 中最新保存的 PATH。
4. 检查 FFmpeg 命令：

   ```powershell
   ffmpeg -version
   ```

5. 确认该版本带 MP3 编码器：

   ```powershell
   ffmpeg -hide_banner -encoders | findstr /i libmp3lame
   ```

   输出中应包含 `libmp3lame`。导入脚本也会在转码前自动检查这一项。

如果 WinGet 找不到该包或不能自动配置 PATH，可使用下一种方式。

### 方式二：手动配置

1. 从 FFmpeg 官方下载页进入 Windows builds：
   <https://ffmpeg.org/download.html>
2. 选择带 `libmp3lame` 的完整 Windows build，下载并解压。
3. 找到包含 `ffmpeg.exe` 的 `bin` 文件夹。例如：
   `C:\ffmpeg\bin\ffmpeg.exe`
4. 将 `bin` 文件夹添加到 Windows“用户环境变量”的 `Path`，然后重新打开终端。
5. 按上面的命令检查 `ffmpeg -version` 和 `libmp3lame`。

如果不想改 PATH，也可以在运行导入脚本时直接提供完整路径：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\import-new-songs.ps1 -FfmpegPath "C:\ffmpeg\bin\ffmpeg.exe"
```

## 导入歌曲

1. 将音频（MP3、WAV、FLAC、M4A、AAC、OGG、OPUS、WMA、AIFF、APE 或 ALAC）放入 `music\新增音乐`。
2. 可选：把对应的 `.lrc` 歌词也放进去。歌词文件名需符合现有规则，例如 `歌名-歌手-歌词.lrc`。
3. 在 VS Code 中打开工作区文件夹 `E:\Desktop\202410`。通过菜单 **终端 → 运行任务**，选择 **预览新增歌曲导入**；检查终端中显示的音频和歌词清单。也可以在项目根目录运行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\import-new-songs.ps1 -Check
   ```

4. 确认后，在 VS Code 的 **终端 → 运行任务** 中选择 **导入新增歌曲**，或在项目根目录运行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\import-new-songs.ps1
   ```

5. 音频会转成 128 kbps MP3 并放进 `music`；歌词会同步到 `music\lyric`，歌单和歌词索引由 `tools\add-song.ps1` 更新。全部导入成功后，`music\新增音乐` 中的原始输入会删除；若压缩或同步失败，原始文件会保留。

可通过 `-BitrateKbps 192` 改用 192 kbps，例如：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\import-new-songs.ps1 -BitrateKbps 192
```

码率越高，音质通常越好、文件也越大。请勿把已经压缩过的音频反复转码。

## 常见问题

- **提示找不到 FFmpeg**：重新打开终端；仍找不到时检查 PATH，或使用 `-FfmpegPath` 指定 `ffmpeg.exe`。
- **提示没有 `libmp3lame`**：更换包含该编码器的完整 Windows build。转码使用的命令本身不需要管理员权限。
- **提示目标歌曲或歌词已存在**：脚本不会覆盖已有文件；请先检查重名文件并自行改名。
- **转码或索引同步失败**：脚本会保留“新增音乐”中的原文件，不会删除未成功处理的输入。
