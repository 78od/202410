const audio = document.querySelector("#daily-song");
const title = document.querySelector("#music-title");
const randomSongButton = document.querySelector("#random-song-button");
const songSearchInput = document.querySelector("#song-search-input");
const songSearchResults = document.querySelector("#song-search-results");
const songSearchStatus = document.querySelector("#song-search-status");
const musicDirectory = new URL("../music/", document.currentScript.src);
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const startDay = Date.UTC(2026, 9, 31) / millisecondsPerDay;
const todaySong = "我不难过-孙燕姿.mp3";
let currentSong;
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

function showSong(song) {
  const isPlaying = !audio.paused;
  currentSong = song;
  title.textContent = song.replace(/\.[^.]+$/, "");
  audio.src = new URL(encodeURIComponent(song), musicDirectory).href;
  audio.load();

  if (isPlaying) {
    audio.play().catch(() => {
      console.warn("浏览器未允许自动继续播放，请手动点击播放。");
    });
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

loadDailySong();
