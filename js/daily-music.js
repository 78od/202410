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
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const startDay = Date.UTC(2026, 9, 31) / millisecondsPerDay;
const todaySong = "我不难过-孙燕姿.mp3";
let currentSong;
let lyricFiles = [];
let lyricCatalogAvailable = false;
let currentLyrics = [];
let lyricRequestId = 0;
let favoriteSongs = new Set();
let favoritesAvailable = true;
const beijingDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getBeijingDay() {
  const parts = beijingDateFormatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) / millisecondsPerDay;
}

function getDailyIndex(songCount, day) {
  const daysSinceStart = day - startDay;
  return ((daysSinceStart % songCount) + songCount) % songCount;
}

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
  const lyricOverride = lyricFiles.find(
    (file) =>
      song === "手心的蔷薇.mp3" &&
      file === "手心的蔷薇-林俊杰&amp;G.E.M.邓紫棋-歌词.lrc",
  );
  if (lyricOverride) {
    return {
      file: lyricOverride,
      metadata: getLyricMetadata(lyricOverride),
      score: 4,
    };
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

      const hasArtist = normalizedSong.includes(normalizedArtist);
      const exactTitle = normalizedSong === normalizedTitle;
      const exactArtistPair =
        normalizedSong === `${normalizedTitle}${normalizedArtist}` ||
        normalizedSong === `${normalizedArtist}${normalizedTitle}`;

      return {
        file,
        metadata,
        score: exactArtistPair ? 3 : hasArtist ? 2 : exactTitle ? 1 : 0,
      };
    })
    .filter((match) => match !== null)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));

  return matches[0] ?? null;
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
  currentLyrics = [];
  lyricLines.replaceChildren();
  lyricLines.hidden = true;
  lyricsStatus.hidden = false;
  lyricsStatus.textContent = "正在载入歌词…";

  if (!lyricCatalogAvailable) {
    lyricsStatus.textContent = "歌词索引加载失败，请检查歌词文件";
    return;
  }

  const match = findLyricFile(song);
  if (!match) {
    lyricsStatus.textContent = "暂无对应歌词";
    return;
  }

  try {
    const response = await fetch(new URL(encodeURIComponent(match.file), new URL("lyric/", musicDirectory)));
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
    for (const entry of entries) {
      const line = document.createElement("li");
      line.className = "lyric-line";
      line.textContent = entry.text;
      lyricLines.append(line);
    }
    lyricsStatus.hidden = true;
    lyricsStatus.textContent = "";
    lyricLines.hidden = false;
    updateLyricScroll();
  } catch (error) {
    if (requestId === lyricRequestId) {
      lyricsStatus.textContent = "歌词加载失败，请检查歌词文件";
    }
    console.error("歌词加载失败", { song, lyricFile: match.file, error });
  }
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
    const previousLine = lyricLines.querySelector(".is-active");
    previousLine?.classList.remove("is-active");
    previousLine?.removeAttribute("aria-current");
    if (previousLine) {
      lyricLines.scrollTo({ top: 0, behavior: "auto" });
    }
    return;
  }

  const activeLine = lyricLines.children[activeIndex];
  if (!activeLine || activeLine.classList.contains("is-active")) {
    return;
  }

  lyricLines.querySelector(".is-active")?.classList.remove("is-active");
  lyricLines.querySelector('[aria-current="true"]')?.removeAttribute("aria-current");
  activeLine.classList.add("is-active");
  activeLine.setAttribute("aria-current", "true");

  const top =
    activeLine.offsetTop -
    lyricLines.offsetTop -
    (lyricLines.clientHeight - activeLine.offsetHeight) / 2;
  lyricLines.scrollTo({
    top: Math.max(0, top),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
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

async function loadDailySong() {
  try {
    const response = await fetch(new URL("playlist.json", musicDirectory));
    if (!response.ok) {
      throw new Error(`歌曲清单加载失败：HTTP ${response.status}`);
    }

    const songs = await response.json();
    if (!Array.isArray(songs) || songs.length === 0 || songs.some((song) => typeof song !== "string")) {
      throw new Error("歌曲清单格式无效或为空");
    }

    try {
      const lyricResponse = await fetch(new URL("lyric/index.json", musicDirectory));
      if (!lyricResponse.ok) {
        throw new Error(`歌词索引加载失败：HTTP ${lyricResponse.status}`);
      }

      const files = await lyricResponse.json();
      if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
        throw new Error("歌词索引格式无效");
      }

      lyricFiles = files;
      lyricCatalogAvailable = true;
    } catch (error) {
      lyricsStatus.textContent = "歌词索引加载失败，请检查歌词文件";
      console.error("歌词索引加载失败", error);
    }

    loadFavorites();
    let currentDay = getBeijingDay();
    showSong(currentDay === startDay ? todaySong : songs[getDailyIndex(songs.length, currentDay)]);
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

    window.setInterval(() => {
      const newDay = getBeijingDay();
      if (newDay !== currentDay) {
        currentDay = newDay;
        showSong(newDay === startDay ? todaySong : songs[getDailyIndex(songs.length, newDay)]);
      }
    }, 60 * 1000);
  } catch (error) {
    title.textContent = "今日歌曲加载失败，请检查歌曲清单";
    console.error(error);
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

loadDailySong();
