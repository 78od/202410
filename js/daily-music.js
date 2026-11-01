const audio = document.querySelector("#daily-song");
const title = document.querySelector("#music-title");
const randomSongButton = document.querySelector("#random-song-button");
const songSearchInput = document.querySelector("#song-search-input");
const songSearchResults = document.querySelector("#song-search-results");
const songSearchStatus = document.querySelector("#song-search-status");
const lyricsStatus = document.querySelector("#lyrics-status");
const lyricLines = document.querySelector("#lyric-lines");
const favoriteSongButton = document.querySelector("#favorite-song-button");
const favoritesToggleButton = document.querySelector("#favorites-toggle-button");
const favoriteSongList = document.querySelector("#favorite-song-list");
const favoriteSongStatus = document.querySelector("#favorite-song-status");
const musicDirectory = new URL("../music/", document.currentScript.src);
const favoritesStorageKey = "202410-music-favorites";
let currentSong;
let lyricFiles = [];
let lyricCatalogAvailable = false;
let currentLyrics = [];
let lyricScrollPositions = [];
let activeLyricIndex = -1;
let lyricRequestId = 0;
let lyricAnimationFrame = 0;
let lyricFollowResumeTimeout = 0;
let lyricFollowPaused = false;
let lyricFollowCatchingUp = false;
let lyricFollowLastFrameTime = 0;
let lyricCatalogPromise;
let favoriteSongs = new Set();
let favoritesAvailable = true;
const lyricOverrides = new Map([
  ["当你.mp3", "当你-林俊杰-歌词.lrc"],
  ["刻在我心底的名字-卢广仲.mp3", "刻在我心底的名字-卢广仲-歌词.lrc"],
]);

function normalizeTrackText(value) {
  return value
    .replaceAll("&amp;", "&")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\-－_()（）·.,!！&/]+/g, "");
}

function getLyricMetadata(file) {
  const stem = file.slice(0, -"-歌词.lrc".length).replaceAll("&amp;", "&");
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
      if (!normalizedSong.includes(normalizedTitle)) {
        return null;
      }

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
    const timestamps = [...line.matchAll(timestampPattern)];
    if (timestamps.length === 0) {
      continue;
    }

    const lyric = line.replace(timestampPattern, "").trim();
    if (!lyric || /^(lyrics by|composed by|tme.*版权|作词|作曲|编曲|制作|监制|演唱|出品|词[:：]|曲[:：])/i.test(lyric)) {
      continue;
    }

    for (const [, minutes, seconds, fraction = ""] of timestamps) {
      const time =
        Number(minutes) * 60 +
        Number(seconds) +
        (fraction ? Number(`0.${fraction}`) : 0);
      const normalizedLyric = normalizeTrackText(lyric);
      if (
        time <= 5 &&
        normalizedLyric.includes(normalizedTitle) &&
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
    const previous = grouped.at(-1);
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
      throw new Error("歌词文件编码不是 UTF-8 或 GB18030", { cause: gb18030Error });
    }
  }
}

async function loadLyrics(song) {
  const requestId = ++lyricRequestId;
  window.clearTimeout(lyricFollowResumeTimeout);
  lyricFollowResumeTimeout = 0;
  lyricFollowPaused = false;
  lyricFollowCatchingUp = false;
  lyricFollowLastFrameTime = 0;
  currentLyrics = [];
  lyricScrollPositions = [];
  activeLyricIndex = -1;
  lyricLines.replaceChildren();
  if (lyricLines.scrollTop !== 0) {
    lyricLines.scrollTop = 0;
  }
  lyricLines.hidden = true;
  lyricsStatus.hidden = false;
  lyricsStatus.textContent = "正在载入歌词…";

  if (!lyricCatalogAvailable) {
    const catalogLoaded = await lyricCatalogPromise;
    if (requestId !== lyricRequestId) {
      return;
    }
    if (!catalogLoaded) {
      lyricsStatus.textContent = "歌词索引加载失败，请检查歌词文件";
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
      lyricsStatus.textContent = "这首歌的歌词文件没有可滚动歌词";
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
  const boundedTarget = Math.max(0, target);
  if (!lyricFollowCatchingUp) {
    lyricFollowCatchingUp = false;
    lyricLines.scrollTop = boundedTarget;
    return;
  }

  const now = performance.now();
  const elapsed = Math.min(now - lyricFollowLastFrameTime, 50);
  lyricFollowLastFrameTime = now;
  const distance = boundedTarget - lyricLines.scrollTop;
  const maxStep = 2200 * elapsed / 1000;
  if (Math.abs(distance) <= maxStep) {
    lyricLines.scrollTop = boundedTarget;
    lyricFollowCatchingUp = false;
    return;
  }

  lyricLines.scrollTop += Math.sign(distance) * maxStep;
}

function updateLyricScroll() {
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
    if (activeLyricIndex >= 0) {
      const previousLine = lyricLines.children[activeLyricIndex]?.firstElementChild;
      previousLine?.classList.remove("is-active");
      previousLine?.removeAttribute("aria-current");
      activeLyricIndex = -1;
    }
    if (!lyricFollowPaused) {
      scrollLyricsTo(0);
    }
    return;
  }

  if (activeIndex !== activeLyricIndex) {
    const previousLine = lyricLines.children[activeLyricIndex]?.firstElementChild;
    previousLine?.classList.remove("is-active");
    previousLine?.removeAttribute("aria-current");
    const activeLine = lyricLines.children[activeIndex]?.firstElementChild;
    if (!activeLine) {
      return;
    }
    activeLine.classList.add("is-active");
    activeLine.setAttribute("aria-current", "true");
    activeLyricIndex = activeIndex;
  }

  if (lyricFollowPaused) {
    return;
  }

  let scrollTop = lyricScrollPositions[activeIndex];
  if (activeIndex + 1 < lyricScrollPositions.length) {
    const activeTime = currentLyrics[activeIndex].time;
    const nextTime = currentLyrics[activeIndex + 1].time;
    const progress = Math.min(1, Math.max(0, (audio.currentTime - activeTime) / (nextTime - activeTime)));
    scrollTop += (lyricScrollPositions[activeIndex + 1] - scrollTop) * progress;
  }

  scrollLyricsTo(scrollTop);
}

function pauseLyricFollow() {
  lyricFollowPaused = true;
  window.clearTimeout(lyricFollowResumeTimeout);
  lyricFollowResumeTimeout = window.setTimeout(() => {
    lyricFollowPaused = false;
    lyricFollowResumeTimeout = 0;
    lyricFollowCatchingUp = true;
    lyricFollowLastFrameTime = performance.now();
    updateLyricScroll();
    startLyricScroll();
  }, 3000);
}

function resumeLyricFollow() {
  window.clearTimeout(lyricFollowResumeTimeout);
  lyricFollowResumeTimeout = 0;
  lyricFollowPaused = false;
  lyricFollowCatchingUp = false;
  updateLyricScroll();
}

lyricLines.addEventListener("wheel", pauseLyricFollow, { passive: true });
lyricLines.addEventListener("touchmove", pauseLyricFollow, { passive: true });
lyricLines.addEventListener("pointerdown", pauseLyricFollow);
window.addEventListener("pointerup", pauseLyricFollow);
window.addEventListener("pointercancel", pauseLyricFollow);
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

window.addEventListener("resize", refreshLyricScrollPositions);

function animateLyricScroll() {
  lyricAnimationFrame = 0;
  updateLyricScroll();
  if ((!audio.paused && !audio.ended) || lyricFollowCatchingUp) {
    lyricAnimationFrame = window.requestAnimationFrame(animateLyricScroll);
  }
}

function startLyricScroll() {
  if (lyricAnimationFrame === 0) {
    lyricAnimationFrame = window.requestAnimationFrame(animateLyricScroll);
  }
}

function stopLyricScroll() {
  if (lyricAnimationFrame !== 0) {
    window.cancelAnimationFrame(lyricAnimationFrame);
    lyricAnimationFrame = 0;
  }
  updateLyricScroll();
  if (lyricFollowCatchingUp) {
    startLyricScroll();
  }
}

function showSong(song) {
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
  favoriteSongList.replaceChildren();
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
  songSearchResults.replaceChildren();
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
    loadFavorites();
    loadFavorites();
    showSong(songs[Math.floor(Math.random() * songs.length)]);
    songSearchInput.disabled = false;
    songSearchInput.addEventListener("input", () => {
      renderSongSearchResults(songs, songSearchInput.value.trim());
    });
    randomSongButton.disabled = songs.length < 2;
    randomSongButton.addEventListener("click", () => {
      if (songs.length > 1) {
        showSong(getRandomSong(songs));
      }
    });
    favoriteSongButton.disabled = !favoritesAvailable;
    favoritesToggleButton.disabled = !favoritesAvailable;
    favoriteSongButton.addEventListener("click", () => {
      saveFavorite(currentSong, !favoriteSongs.has(currentSong), songs);
    });
    favoritesToggleButton.addEventListener("click", () => {
      const isExpanded = favoritesToggleButton.getAttribute("aria-expanded") === "true";
      favoritesToggleButton.setAttribute("aria-expanded", String(!isExpanded));
      favoriteSongList.hidden = isExpanded;
      if (!isExpanded) {
        renderFavoriteList(songs);
      }
    });
    renderFavoriteList(songs);
    audio.addEventListener("ended", () => {
      if (songs.length < 2) {
        return;
      }

      showSong(getRandomSong(songs));
      audio.play().catch((error) => {
        console.warn("下一首歌曲无法自动播放，请手动点击播放。", error);
      });
    });
  } catch (error) {
    title.textContent = "歌曲加载失败，请检查歌曲清单";
    console.error(error);
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
  title.textContent = "歌曲加载失败，请检查网络或音频文件路径";
  console.error("音频加载失败", {
    source: audio.currentSrc,
    error: audio.error,
  });
});

audio.addEventListener("timeupdate", updateLyricScroll);
audio.addEventListener("seeked", updateLyricScroll);
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
  startLyricScroll();
});
audio.addEventListener("pause", stopLyricScroll);

loadPlaylist();
