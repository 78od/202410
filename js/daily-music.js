const audio = document.querySelector("#daily-song");
const title = document.querySelector("#music-title");
const randomSongButton = document.querySelector("#random-song-button");
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const startDay = Date.UTC(2026, 9, 31) / millisecondsPerDay;
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

function getDailyIndex(songCount) {
  const daysSinceStart = getBeijingDay() - startDay;
  return ((daysSinceStart % songCount) + songCount) % songCount;
}

function showSong(song) {
  const isPlaying = !audio.paused;
  currentSong = song;
  title.textContent = song.replace(/\.[^.]+$/, "");
  audio.src = `/202410/music/${encodeURIComponent(song)}`;
  audio.load();

  if (isPlaying) {
    audio.play().catch(() => {
      console.warn("浏览器未允许自动继续播放，请手动点击播放。");
    });
  }
}

async function loadDailySong() {
  try {
    const response = await fetch("/202410/music/playlist.json");
    if (!response.ok) {
      throw new Error(`歌曲清单加载失败：HTTP ${response.status}`);
    }

    const songs = await response.json();
    if (!Array.isArray(songs) || songs.length === 0 || songs.some((song) => typeof song !== "string")) {
      throw new Error("歌曲清单格式无效或为空");
    }

    let currentDay = getBeijingDay();
    showSong(songs[getDailyIndex(songs.length)]);
    randomSongButton.disabled = songs.length < 2;
    randomSongButton.addEventListener("click", () => {
      const alternatives = songs.filter((song) => song !== currentSong);
      if (alternatives.length > 0) {
        const randomSong = alternatives[Math.floor(Math.random() * alternatives.length)];
        showSong(randomSong);
      }
    });

    window.setInterval(() => {
      const newDay = getBeijingDay();
      if (newDay !== currentDay) {
        currentDay = newDay;
        showSong(songs[getDailyIndex(songs.length)]);
      }
    }, 60 * 1000);
  } catch (error) {
    title.textContent = "今日歌曲加载失败，请检查歌曲清单";
    console.error(error);
  }
}

loadDailySong();
