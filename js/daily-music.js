const audio = document.querySelector("#daily-song");
const title = document.querySelector("#music-title");
const audioStatus = document.querySelector("#audio-status");
const audioRetryButton = document.querySelector("#audio-retry-button");
const playlistRetryButton = document.querySelector("#playlist-retry-button");
const randomSongButton = document.querySelector("#random-song-button");
const loopSongButton = document.querySelector("#loop-song-button");
const songSearchInput = document.querySelector("#song-search-input");
const songSearchResults = document.querySelector("#song-search-results");
const songSearchStatus = document.querySelector("#song-search-status");
const lyricsStatus = document.querySelector("#lyrics-status");
const lyricsRetryButton = document.querySelector("#lyrics-retry-button");
const lyricLines = document.querySelector("#lyric-lines");
const favoriteSongButton = document.querySelector("#favorite-song-button");
const favoritesToggleButton = document.querySelector("#favorites-toggle-button");
const favoriteSongList = document.querySelector("#favorite-song-list");
const favoriteSongStatus = document.querySelector("#favorite-song-status");
const musicDirectory = new URL("../music/", document.currentScript.src);
const favoritesStorageKey = "202410-music-favorites";
const volumeStorageKey = "202410-music-volume";
let currentSong;
let lyricFiles = [];
let lyricCatalogAvailable = false;
let currentLyrics = [];
let lyricScrollPositions = [];
let lyricScrollTarget = 0;
let lyricResizeFrame = 0;
let activeLyricIndex = -1;
let lyricRequestId = 0;
let lyricScrollAnimationFrame = 0;
let lyricFollowResumeTimeout = 0;
let lyricFollowPaused = false;
let lyricCatalogPromise;
let favoriteSongs = new Set();
let favoritesAvailable = true;
let playlistSongs = [];
let searchInputFrame = 0;
const audioStallTimeoutMs = 12000;
const maxAudioRecoveryAttempts = 2;
let audioStallTimeout = 0;
let audioRecoveryAttempts = 0;
let audioRecoveryVersion = 0;
const lyricOverrides = new Map([
  ["当你.mp3", "当你-林俊杰-歌词.lrc"],
  ["刻在我心底的名字-卢广仲.mp3", "刻在我心底的名字-卢广仲-歌词.lrc"],
]);

try {
  const storedVolume = localStorage.getItem(volumeStorageKey);
  if (storedVolume !== null) {
    const volume = Number(storedVolume);
    if (Number.isFinite(volume) && volume >= 0 && volume <= 1) {
      audio.volume = volume;
    } else {
      console.warn("保存的音量设置无效，已使用默认音量。");
    }
  }
} catch (error) {
  console.error("音量设置读取失败", error);
}

audio.addEventListener("volumechange", () => {
  try {
    localStorage.setItem(volumeStorageKey, String(audio.volume));
  } catch (error) {
    console.error("音量设置保存失败", error);
  }
});

audioRetryButton.addEventListener("click", () => {
  audioRetryButton.hidden = true;
  audioStatus.textContent = "正在重试音频加载…";
  audio.load();
  audio.play().catch((error) => {
    if (!audio.error) {
      audioStatus.textContent = "音频已准备好，请点击播放器开始播放";
    }
    console.warn("音频重试后无法自动播放", error);
  });
});

playlistRetryButton.addEventListener("click", () => {
  void loadPlaylist();
});

lyricsRetryButton.addEventListener("click", async () => {
  lyricsRetryButton.disabled = true;
  lyricCatalogAvailable = false;
  lyricCatalogPromise = loadLyricCatalog();
  await loadLyrics(currentSong);
  lyricsRetryButton.disabled = false;
});

loopSongButton.addEventListener("click", () => {
  audio.loop = !audio.loop;
  loopSongButton.setAttribute("aria-pressed", String(audio.loop));
  loopSongButton.textContent = `单曲循环：${audio.loop ? "开" : "关"}`;
});

function normalizeTrackText(value) {
  return value
    .replace(/&amp;/g, "&")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\-－_()（）·.,!！&/]+/g, "");
}

// 歌词文件开头的制作信息行（词/曲/编曲/录音师/OP…）统一按“标签：内容”的形式出现，
// 这里按标签关键词判断，避免把“Jay：…”“合：…”这类对唱标记一起删掉。
const creditLabelPattern = new RegExp(
  "词|曲|编曲|改编|原唱|制作|监制|^监|出品|发行|版权|统筹|宣推|推广|企划|企宣|策划|经纪|助理|" +
    "妆发|工程|编程|编成|录音|混音|母带|录制|人声|配唱|和声|合声|和音|演唱|吉他|贝斯|鼓|" +
    "钢琴|琴|弦乐|提琴|簧管|笛|童声|编辑|键盘|乌克丽丽|" +
    "\\b(?:op|sp|studio|bass|drums?|guitars?|strings?|composer|composed|lyricist|lyrics?|producer|" +
    "mixing?|master(?:ing)?|record(?:ing|ed)?|vocals?|piano|keys?|keyboards?|arrangement|adapt|" +
    "assistant|engineer)\\b",
  "i",
);
const creditPunctuationPattern = /[，。！？、；]/;
const creditPrefixPattern = /^(?:lyrics by|composed by|tme.*版权|作词|作曲|编曲|制作|监制|演唱|出品)/i;

function isCreditLine(text) {
  const separatorIndex = text.search(/[：:]/);
  if (separatorIndex <= 0 || separatorIndex > 40) {
    return false;
  }

  const label = text.slice(0, separatorIndex).trim();
  if (!label || creditPunctuationPattern.test(label)) {
    return false;
  }

  return creditLabelPattern.test(label);
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function getLyricMetadata(file) {
  const stem = file.slice(0, -"-歌词.lrc".length).replace(/&amp;/g, "&");
  const separator = stem.indexOf("-");
  if (separator < 0) {
    return null;
  }

  return {
    title: stem.slice(0, separator),
    artist: stem.slice(separator + 1),
  };
}

function findLyricFile(song) {
  const override = lyricOverrides.get(song);
  if (override) {
    const file = lyricFiles.find((lyricFile) => lyricFile === override);
    if (file) {
      return { file, metadata: getLyricMetadata(file), score: 4 };
    }

    console.error("指定的歌词文件不在歌词索引中", { song, lyricFile: override });
    return null;
  }

  const songStem = song.replace(/\.[^.]+$/, "");
  const normalizedSong = normalizeTrackText(songStem);
  const matches = lyricFiles
    .map((file) => {
      const metadata = getLyricMetadata(file);
      if (!metadata) {
        return null;
      }

      const normalizedTitle = normalizeTrackText(metadata.title);
      const normalizedArtist = normalizeTrackText(metadata.artist);
      const exactTitle = normalizedSong === normalizedTitle;
      const exactArtistPair =
        normalizedSong === `${normalizedTitle}${normalizedArtist}` ||
        normalizedSong === `${normalizedArtist}${normalizedTitle}`;
      if (!exactTitle && !exactArtistPair) {
        return null;
      }

      return {
        file,
        metadata,
        score: exactArtistPair ? 3 : 1,
      };
    })
    .filter((match) => match !== null)
    .sort((left, right) => right.score - left.score);

  const bestMatch = matches[0];
  if (!bestMatch) {
    return null;
  }

  const equallyRankedMatches = matches.filter((match) => match.score === bestMatch.score);
  if (equallyRankedMatches.length > 1) {
    console.error("歌曲对应多个歌词版本，请为该歌曲指定歌手", {
      song,
      lyricFiles: equallyRankedMatches.map((match) => match.file),
    });
    return null;
  }

  return bestMatch;
}

function parseLrc(text, metadata) {
  const timestampPattern = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const normalizedTitle = normalizeTrackText(metadata.title);
  const normalizedArtists = metadata.artist
    .split(/[&/]/)
    .map(normalizeTrackText)
    .filter(Boolean);
  const entries = [];

  for (const line of text.split(/\r?\n/)) {
    const timestamps = [];
    let timestamp;
    while ((timestamp = timestampPattern.exec(line)) !== null) {
      timestamps.push(timestamp);
    }
    if (timestamps.length === 0) {
      continue;
    }

    timestampPattern.lastIndex = 0;
    const lyric = line.replace(timestampPattern, "").trim();
    if (!lyric || isCreditLine(lyric) || creditPrefixPattern.test(lyric)) {
      continue;
    }

    for (const [, minutes, seconds, fraction = ""] of timestamps) {
      const time =
        Number(minutes) * 60 +
        Number(seconds) +
        (fraction ? Number(`0.${fraction}`) : 0);
      const normalizedLyric = normalizeTrackText(lyric);
      // 开头几秒常有一行“歌名 - 歌手”的版权信息，文件名与歌词内写法不一致时也要识别出来
      const looksLikeTitleLine =
        normalizedLyric.includes(normalizedTitle) || /[-–—]/.test(lyric);
      if (
        time <= 5 &&
        looksLikeTitleLine &&
        normalizedArtists.every((artist) => normalizedLyric.includes(artist))
      ) {
        continue;
      }

      entries.push({
        time,
        text: lyric,
      });
    }
  }

  entries.sort((left, right) => left.time - right.time);
  return entries.reduce((grouped, entry) => {
    const previous = grouped[grouped.length - 1];
    if (previous && previous.time === entry.time) {
      previous.text += `\n${entry.text}`;
    } else {
      grouped.push(entry);
    }
    return grouped;
  }, []);
}

function decodeLyric(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (utf8Error) {
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(buffer);
    } catch (gb18030Error) {
      console.error("歌词解码失败", gb18030Error);
      throw new Error("歌词文件编码不是 UTF-8 或 GB18030");
    }
  }
}

async function loadLyrics(song) {
  const requestId = ++lyricRequestId;
  window.clearTimeout(lyricFollowResumeTimeout);
  lyricFollowResumeTimeout = 0;
  lyricFollowPaused = false;
  cancelLyricScrollAnimation();
  currentLyrics = [];
  lyricScrollPositions = [];
  activeLyricIndex = -1;
  clearElement(lyricLines);
  if (lyricLines.scrollTop !== 0) {
    lyricLines.scrollTop = 0;
  }
  lyricLines.hidden = true;
  lyricsStatus.hidden = false;
  lyricsRetryButton.hidden = true;
  lyricsStatus.textContent = "正在载入歌词…";

  if (!lyricCatalogAvailable) {
    const catalogLoaded = await lyricCatalogPromise;
    if (requestId !== lyricRequestId) {
      return;
    }
    if (!catalogLoaded) {
      lyricsStatus.textContent = "歌词索引加载失败，请检查歌词文件";
      lyricsRetryButton.hidden = false;
      return;
    }
  }

  const match = findLyricFile(song);
  if (!match) {
    lyricsStatus.textContent = "暂无对应歌词";
    return;
  }

  try {
    const response = await fetch(
      new URL(encodeURIComponent(match.file), new URL("lyric/", musicDirectory)),
    );
    if (!response.ok) {
      throw new Error(`歌词加载失败：HTTP ${response.status}`);
    }

    const entries = parseLrc(decodeLyric(await response.arrayBuffer()), match.metadata);
    if (requestId !== lyricRequestId) {
      return;
    }

    title.textContent = `${match.metadata.title} - ${match.metadata.artist}`;
    if (entries.length === 0) {
      lyricsStatus.textContent = "暂无对应歌词";
      return;
    }

    currentLyrics = entries;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const item = document.createElement("li");
      item.className = "lyric-item";
      const line = document.createElement("button");
      line.className = "lyric-line";
      line.type = "button";
      line.textContent = entry.text;
      line.dataset.index = String(fragment.childElementCount);
      const minutes = Math.floor(entry.time / 60);
      const seconds = Math.floor(entry.time % 60).toString().padStart(2, "0");
      line.setAttribute("aria-label", `跳转到 ${minutes}:${seconds}：${entry.text}`);
      item.append(line);
      fragment.append(item);
    }
    lyricLines.append(fragment);
    lyricsStatus.hidden = true;
    lyricsStatus.textContent = "";
    lyricLines.hidden = false;
    refreshLyricScrollPositions();
    updateLyricScroll();
  } catch (error) {
    if (requestId === lyricRequestId) {
      lyricsStatus.textContent = "歌词加载失败，请检查歌词文件";
      lyricsRetryButton.hidden = false;
    }
    console.error("歌词加载失败", { song, lyricFile: match.file, error });
  }
}

function refreshLyricScrollPositions() {
  lyricScrollPositions = Array.from(lyricLines.children, (item) =>
    Math.max(
      0,
      item.offsetTop -
        lyricLines.offsetTop -
        (lyricLines.clientHeight - item.offsetHeight) / 2,
    ),
  );
}

function scrollLyricsTo(target) {
  const destination = Math.max(0, target);
  if (
    lyricScrollAnimationFrame !== 0 &&
    Math.abs(destination - lyricScrollTarget) < 1
  ) {
    return;
  }

  cancelLyricScrollAnimation();
  const start = lyricLines.scrollTop;
  lyricScrollTarget = destination;
  if (
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    Math.abs(destination - start) < 1
  ) {
    lyricLines.scrollTop = destination;
    return;
  }

  const startTime = performance.now();
  const duration = 260;
  const animate = (now) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const easedProgress = 1 - (1 - progress) ** 3;
    lyricLines.scrollTop = start + (destination - start) * easedProgress;
    if (progress < 1) {
      lyricScrollAnimationFrame = window.requestAnimationFrame(animate);
    } else {
      lyricScrollAnimationFrame = 0;
    }
  };
  lyricScrollAnimationFrame = window.requestAnimationFrame(animate);
}

function cancelLyricScrollAnimation() {
  if (lyricScrollAnimationFrame !== 0) {
    window.cancelAnimationFrame(lyricScrollAnimationFrame);
    lyricScrollAnimationFrame = 0;
  }
}

function updateLyricScroll(forceScroll = false) {
  if (currentLyrics.length === 0) {
    return;
  }

  let low = 0;
  let high = currentLyrics.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (currentLyrics[middle].time <= audio.currentTime) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const activeIndex = low - 1;
  if (activeIndex < 0) {
    const activeIndexChanged = activeLyricIndex >= 0;
    if (activeLyricIndex >= 0) {
      const previousItem = lyricLines.children[activeLyricIndex];
      const previousLine = previousItem ? previousItem.firstElementChild : null;
      if (previousLine) {
        previousLine.classList.remove("is-active");
        previousLine.removeAttribute("aria-current");
      }
      activeLyricIndex = -1;
    }
    if (!lyricFollowPaused && (activeIndexChanged || forceScroll)) {
      scrollLyricsTo(0);
    }
    return;
  }

  const activeIndexChanged = activeIndex !== activeLyricIndex;
  if (activeIndexChanged) {
    const previousItem = lyricLines.children[activeLyricIndex];
    const previousLine = previousItem ? previousItem.firstElementChild : null;
    if (previousLine) {
      previousLine.classList.remove("is-active");
      previousLine.removeAttribute("aria-current");
    }
    const activeItem = lyricLines.children[activeIndex];
    const activeLine = activeItem ? activeItem.firstElementChild : null;
    if (!activeLine) {
      return;
    }
    activeLine.classList.add("is-active");
    activeLine.setAttribute("aria-current", "true");
    activeLyricIndex = activeIndex;
  }

  if (lyricFollowPaused || (!activeIndexChanged && !forceScroll)) {
    return;
  }

  scrollLyricsTo(lyricScrollPositions[activeIndex]);
}

function pauseLyricFollow() {
  lyricFollowPaused = true;
  cancelLyricScrollAnimation();
  window.clearTimeout(lyricFollowResumeTimeout);
  lyricFollowResumeTimeout = window.setTimeout(() => {
    lyricFollowPaused = false;
    lyricFollowResumeTimeout = 0;
    updateLyricScroll(true);
  }, 3000);
}

function resumeLyricFollow() {
  window.clearTimeout(lyricFollowResumeTimeout);
  lyricFollowResumeTimeout = 0;
  lyricFollowPaused = false;
  updateLyricScroll(true);
}

lyricLines.addEventListener("wheel", pauseLyricFollow, { passive: true });
lyricLines.addEventListener("touchmove", pauseLyricFollow, { passive: true });
lyricLines.addEventListener("pointerdown", pauseLyricFollow);
lyricLines.addEventListener("keydown", (event) => {
  if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
    pauseLyricFollow();
  }
});

lyricLines.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const line = event.target.closest(".lyric-line");
  if (!line || !lyricLines.contains(line)) {
    return;
  }

  const entry = currentLyrics[Number(line.dataset.index)];
  if (entry) {
    audio.currentTime = entry.time;
    resumeLyricFollow();
  }
});

window.addEventListener("resize", () => {
  if (lyricResizeFrame !== 0) {
    return;
  }
  lyricResizeFrame = window.requestAnimationFrame(() => {
    lyricResizeFrame = 0;
    refreshLyricScrollPositions();
  });
});

function showSong(song) {
  window.clearTimeout(audioStallTimeout);
  audioStallTimeout = 0;
  audioRecoveryAttempts = 0;
  audioRecoveryVersion += 1;
  audioStatus.textContent = "";
  audioRetryButton.hidden = true;
  const isPlaying = !audio.paused;
  currentSong = song;
  title.textContent = song.replace(/\.[^.]+$/, "");
  void loadLyrics(song);
  updateFavoriteButton();
  audio.src = new URL(encodeURIComponent(song), musicDirectory).href;
  audio.load();

  if (isPlaying) {
    audio.play().catch(() => {
      console.warn("浏览器未允许自动继续播放，请手动点击播放。");
    });
  }
}

function updateFavoriteButton() {
  const isFavorite = favoriteSongs.has(currentSong);
  favoriteSongButton.textContent = isFavorite ? "★ 已收藏" : "☆ 收藏";
  favoriteSongButton.setAttribute("aria-pressed", String(isFavorite));
}

function loadFavorites() {
  try {
    const storedFavorites = localStorage.getItem(favoritesStorageKey);
    if (storedFavorites !== null) {
      const parsedFavorites = JSON.parse(storedFavorites);
      if (!Array.isArray(parsedFavorites) || parsedFavorites.some((song) => typeof song !== "string")) {
        throw new Error("收藏数据格式无效");
      }
      favoriteSongs = new Set(parsedFavorites);
    }
  } catch (error) {
    favoritesAvailable = false;
    favoriteSongStatus.textContent = "收藏读取失败，请检查浏览器存储设置";
    console.error("收藏读取失败", error);
  }
}

function renderFavoriteList(songs) {
  clearElement(favoriteSongList);
  if (!favoritesAvailable) {
    return;
  }

  const savedSongs = songs.filter((song) => favoriteSongs.has(song));
  favoriteSongStatus.textContent = savedSongs.length === 0 ? "还没有收藏歌曲" : `已收藏 ${savedSongs.length} 首歌曲`;

  for (const song of savedSongs) {
    const item = document.createElement("li");
    const playButton = document.createElement("button");
    const removeButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "favorite-song-play";
    playButton.textContent = song.replace(/\.[^.]+$/, "");
    playButton.addEventListener("click", () => {
      showSong(song);
      audio.play().catch((error) => {
        console.warn("歌曲已切换，请点击播放器开始播放。", error);
      });
    });
    removeButton.type = "button";
    removeButton.className = "favorite-song-remove";
    removeButton.textContent = "移除";
    removeButton.setAttribute("aria-label", `从收藏中移除${song.replace(/\.[^.]+$/, "")}`);
    removeButton.addEventListener("click", () => {
      saveFavorite(song, false, songs);
    });
    item.append(playButton, removeButton);
    favoriteSongList.append(item);
  }
}

function saveFavorite(song, shouldFavorite, songs) {
  const updatedFavorites = new Set(favoriteSongs);
  if (shouldFavorite) {
    updatedFavorites.add(song);
  } else {
    updatedFavorites.delete(song);
  }

  try {
    localStorage.setItem(favoritesStorageKey, JSON.stringify([...updatedFavorites]));
    favoriteSongs = updatedFavorites;
    updateFavoriteButton();
    renderFavoriteList(songs);
  } catch (error) {
    favoriteSongStatus.textContent = "收藏保存失败，请检查浏览器存储空间或权限";
    console.error("收藏保存失败", error);
  }
}

function getRandomSong(songs) {
  const alternatives = songs.filter((song) => song !== currentSong);
  return alternatives[Math.floor(Math.random() * alternatives.length)];
}

function renderSongSearchResults(songs, query) {
  clearElement(songSearchResults);
  songSearchStatus.textContent = "";

  if (!query) {
    songSearchResults.hidden = true;
    return;
  }

  const normalizedQuery = query.toLocaleLowerCase();
  const matches = songs.filter((song) =>
    song.replace(/\.[^.]+$/, "").toLocaleLowerCase().includes(normalizedQuery),
  );

  songSearchResults.hidden = false;
  if (matches.length === 0) {
    songSearchStatus.textContent = "没有找到匹配的歌曲";
    return;
  }

  songSearchStatus.textContent = `找到 ${matches.length} 首歌曲`;
  for (const song of matches) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = song.replace(/\.[^.]+$/, "");
    button.addEventListener("click", () => {
      showSong(song);
      audio.play().catch((error) => {
        console.warn("歌曲已切换，请点击播放器开始播放。", error);
      });
      songSearchInput.value = "";
      renderSongSearchResults(songs, "");
    });
    item.append(button);
    songSearchResults.append(item);
  }
}

async function loadPlaylist() {
  playlistRetryButton.disabled = true;
  lyricCatalogPromise = loadLyricCatalog();
  try {
    const response = await fetch(new URL("playlist.json", musicDirectory));
    if (!response.ok) {
      throw new Error(`歌曲清单加载失败：HTTP ${response.status}`);
    }

    const songs = await response.json();
    if (!Array.isArray(songs) || songs.length === 0 || songs.some((song) => typeof song !== "string")) {
      throw new Error("歌曲清单格式无效或为空");
    }
    playlistSongs = songs;
    playlistRetryButton.hidden = true;
    loadFavorites();
    showSong(songs[Math.floor(Math.random() * songs.length)]);
    songSearchInput.disabled = false;
    randomSongButton.disabled = songs.length < 2;
    favoriteSongButton.disabled = !favoritesAvailable;
    favoritesToggleButton.disabled = !favoritesAvailable;
    renderFavoriteList(songs);
  } catch (error) {
    title.textContent = "歌曲清单加载失败";
    audioStatus.textContent = "无法加载歌曲列表，请检查网络后重试";
    playlistRetryButton.hidden = false;
    console.error(error);
  } finally {
    playlistRetryButton.disabled = false;
  }
}

async function loadLyricCatalog() {
  try {
    const response = await fetch(new URL("lyric/index.json", musicDirectory));
    if (!response.ok) {
      throw new Error(`歌词索引加载失败：HTTP ${response.status}`);
    }

    const files = await response.json();
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
      throw new Error("歌词索引格式无效");
    }

    lyricFiles = files;
    lyricCatalogAvailable = true;
    return true;
  } catch (error) {
    console.error("歌词索引加载失败", error);
    return false;
  }
}

audio.addEventListener("error", () => {
  window.clearTimeout(audioStallTimeout);
  audioStallTimeout = 0;
  audioStatus.textContent = "音频加载失败，请检查网络或音频文件路径";
  audioRetryButton.hidden = false;
  audioRetryButton.disabled = false;
  console.error("音频加载失败", {
    source: audio.currentSrc,
    error: audio.error,
  });
});

function recoverStalledAudio() {
  audioStallTimeout = 0;
  if (audio.paused || audio.ended || !audio.currentSrc) {
    return;
  }
  if (audioRecoveryAttempts >= maxAudioRecoveryAttempts) {
    audioStatus.textContent = "网络仍不稳定，请重新播放或更换网络后重试";
    console.warn("音频多次缓冲仍未恢复", {
      source: audio.currentSrc,
      currentTime: audio.currentTime,
    });
    return;
  }

  const source = audio.currentSrc;
  const resumeTime = audio.currentTime;
  const shouldResume = !audio.paused;
  const recoveryVersion = ++audioRecoveryVersion;
  audioRecoveryAttempts += 1;
  audioStatus.textContent = `音频缓冲停滞，正在重连（${audioRecoveryAttempts}/${maxAudioRecoveryAttempts}）…`;

  const resumePlayback = () => {
    if (recoveryVersion !== audioRecoveryVersion || audio.currentSrc !== source) {
      return;
    }
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.min(resumeTime, Math.max(0, audio.duration - 0.1));
    }
    if (shouldResume) {
      audio.play().catch((error) => {
        audioStatus.textContent = "音频已重新连接，请手动点击播放";
        console.warn("音频重连后无法自动播放", error);
      });
    }
  };

  audio.addEventListener("loadedmetadata", resumePlayback, { once: true });
  audio.load();
}

function scheduleAudioRecovery() {
  if (audio.paused || audio.ended || !audio.currentSrc) {
    return;
  }
  if (audioRecoveryAttempts >= maxAudioRecoveryAttempts) {
    audioStatus.textContent = "网络仍不稳定，请重新播放或更换网络后重试";
    return;
  }

  window.clearTimeout(audioStallTimeout);
  audioStatus.textContent = "音频缓冲中…";
  audioStallTimeout = window.setTimeout(recoverStalledAudio, audioStallTimeoutMs);
}

audio.addEventListener("waiting", scheduleAudioRecovery);
audio.addEventListener("stalled", scheduleAudioRecovery);
audio.addEventListener("pause", () => {
  window.clearTimeout(audioStallTimeout);
  audioStallTimeout = 0;
  if (audioStatus.textContent === "音频缓冲中…") {
    audioStatus.textContent = "";
  }
});
audio.addEventListener("playing", () => {
  window.clearTimeout(audioStallTimeout);
  audioStallTimeout = 0;
  audioStatus.textContent = "";
  audioRetryButton.hidden = true;
});
audio.addEventListener("timeupdate", () => updateLyricScroll());
audio.addEventListener("seeked", () => updateLyricScroll(true));
audio.addEventListener("pointerdown", () => {
  audio.preload = "auto";
  audio.fetchPriority = "high";
});
audio.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    audio.preload = "auto";
    audio.fetchPriority = "high";
  }
});
audio.addEventListener("play", () => {
  audio.preload = "auto";
  audio.fetchPriority = "high";
});

songSearchInput.addEventListener("input", () => {
  if (searchInputFrame !== 0) {
    return;
  }
  searchInputFrame = window.requestAnimationFrame(() => {
    searchInputFrame = 0;
    renderSongSearchResults(playlistSongs, songSearchInput.value.trim());
  });
});

randomSongButton.addEventListener("click", () => {
  if (playlistSongs.length > 1) {
    showSong(getRandomSong(playlistSongs));
  }
});

favoriteSongButton.addEventListener("click", () => {
  if (playlistSongs.length === 0) {
    return;
  }
  saveFavorite(currentSong, !favoriteSongs.has(currentSong), playlistSongs);
});

favoritesToggleButton.addEventListener("click", () => {
  const isExpanded = favoritesToggleButton.getAttribute("aria-expanded") === "true";
  favoritesToggleButton.setAttribute("aria-expanded", String(!isExpanded));
  favoriteSongList.hidden = isExpanded;
  if (!isExpanded) {
    renderFavoriteList(playlistSongs);
  }
});

audio.addEventListener("ended", () => {
  if (audio.loop || playlistSongs.length < 2) {
    return;
  }

  showSong(getRandomSong(playlistSongs));
  audio.play().catch((error) => {
    console.warn("下一首歌曲无法自动播放，请手动点击播放。", error);
  });
});

loadPlaylist();
