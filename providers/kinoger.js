// ============================================================
//  KinoGer — Nuvio Provider
//  Port of: PlayTorrioV2/lib/webstreamr/source/kinoger.dart
//            (which itself is a port of webstreamr/src/source/KinoGer.ts)
//
//  Kaynak site: https://kinoger.com  (Almanca, movie + series)
//  Çalışma mantığı:
//    1) TMDB'den Almanca ("de-DE") başlık + yıl çek
//    2) kinoger.com'da arama yap, yıl içeren ilk sonucu seç
//    3) Sayfadaki `.show([...])` JS çağrılarından sezon/bölüm URL'sini çek
//    4) Stream objesi olarak döndür
//
//  NOT (Cloudflare): kinoger.com Cloudflare "managed challenge"
//    arkasındadır. Server-side curl/Node bypass olmaz. Nuvio runtime
//    (Android = okhttp, iOS = NSURLSession) gerçek cihaz TLS fingerprint
//    + User-Agent taşıdığı için genelde geçer. Yine de başarısız olursa
//    provider boş dizi döner (Dart ile aynı davranış).
//
//  Yapı: Tek dosya, Promise chain (async/await yok) — transpile gerekmez.
// ============================================================

var BASE_URL     = 'https://kinoger.com';
var TMDB_API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a'; // PlayTorrioV2 fallback anahtarı

var HEADERS = {
  // Mobil cihaz UA'sı Cloudflare'yi daha kolay geçer
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── TMDB: Almanca başlık + yıl çek ─────────────────────────
// (utils/tmdb.dart → getTmdbNameAndYear port)
function fetchTmdbInfo(tmdbId, mediaType, language) {
  var type     = mediaType === 'tv' ? 'tv' : 'movie';
  var lang     = language || 'de-DE';
  var apiUrl   = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId
               + '?api_key=' + TMDB_API_KEY
               + '&language=' + lang;

  return fetch(apiUrl)
    .then(function (r) {
      if (!r.ok) throw new Error('TMDB yanıt vermedi: ' + r.status);
      return r.json();
    })
    .then(function (d) {
      // Dizi → name + first_air_date  |  Film → title + release_date
      var isTv     = mediaType === 'tv';
      var name     = isTv
        ? (d.name || d.original_name || '')
        : (d.title || d.original_title || '');
      var dateStr  = isTv ? d.first_air_date : d.release_date;
      var year     = dateStr ? parseInt(dateStr.slice(0, 4), 10) || 0 : 0;
      return {
        name:        name,
        year:        year,
        originalName: d.original_name || d.original_title || name
      };
    });
}

// ── kinoger.com'da ara, yıl içeren ilk sonucu seç ──────────
// (kinoger.dart → _fetchPageUrl port)
function searchPageUrl(name, year) {
  var searchUrl = BASE_URL
    + '/?do=search&subaction=search&titleonly=3'
    + '&story=' + encodeURIComponent(name)
    + '&x=0&y=0&submit=submit';

  console.log('[KinoGer] Arama: ' + searchUrl);

  return fetch(searchUrl, { headers: HEADERS, redirect: 'follow' })
    .then(function (r) {
      if (!r.ok) throw new Error('Arama HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) {
      var cheerio = require('cheerio-without-node-native');
      var $       = cheerio.load(html);
      var yearStr = String(year);

      // .title a içinden yıl içeren ilk eşleşmeyi al (Dart ile aynı)
      var hits = [];
      $('.title a').each(function () {
        var text = $(this).text() || '';
        var href = $(this).attr('href') || '';
        if (href && text.indexOf(yearStr) !== -1) {
          hits.push({ text: text.trim(), href: href });
        }
      });

      if (hits.length === 0) {
        console.log('[KinoGer] Yıl (' + yearStr + ') ile eşleşen sonuç yok');
        return null;
      }

      // Göreli URL'yi mutlak hale getir
      var href = hits[0].href;
      if (href.indexOf('http') !== 0) {
        href = BASE_URL + (href.charAt(0) === '/' ? '' : '/') + href;
      }
      console.log('[KinoGer] Sayfa: ' + href + '  (' + hits[0].text + ')');
      return href;
    });
}

// ── `.show(...)` içinden sezon/bölüm URL'sini çek ──────────
// (kinoger.dart → _findEpisodeUrlInShowJs port)
//
//  JS yapısı (tek satırda):
//    .show([["url1","url2"],["url3"]])
//          ^^^^^^^^^^^^  ^^^^^^^^^
//          sezon 0       sezon 1
//  Her sezon bir köşeli parantez listesi; içindeki virgülle ayrılmış
//  elemanlar bölümleri temsil eder. Her eleman URL ile başlar.
function findEpisodeUrlInShowJs(showJs, seasonIndex, episodeIndex) {
  // \[(.*?)\]  — Dart ile aynı: satır içi ilk [ ... ] bloklarını yakalar
  var listRegex = /\[(.*?)\]/g;
  var lists     = [];
  var m;
  while ((m = listRegex.exec(showJs)) !== null) {
    lists.push(m[1]);
  }
  if (seasonIndex < 0 || seasonIndex >= lists.length) return null;

  var parts = lists[seasonIndex].split(',');
  if (episodeIndex < 0 || episodeIndex >= parts.length) return null;

  var urlMatch = parts[episodeIndex].match(/https?:\/\/[^\s'"<>]+/);
  return urlMatch ? urlMatch[0] : null;
}

// ── Sayfa HTML'inden tüm `.show(...)` çağrılarını tara ─────
// (kinoger.dart → handleInternal içindeki döngü port)
//
//  Dart: `RegExp(r'\.show\(.*').allMatches(html)` — `.` default olarak
//  newline yakalamaz, yani satır satır çalışır. JS'de de aynı: split('\n').
function extractStreamsFromPage(html, pageUrl, title, seasonIndex, episodeIndex) {
  var out   = [];
  var lines = html.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line    = lines[i];
    var showPos = line.indexOf('.show(');
    if (showPos === -1) continue;

    // `.show(` sonrasını al, içindeki `[...]` listelerini parse et
    var argStr = line.slice(showPos + '.show('.length);
    var url    = findEpisodeUrlInShowJs(argStr, seasonIndex, episodeIndex);
    if (!url) continue;

    out.push({
      name:    'KinoGer',
      title:   title,
      url:     url,
      quality: 'HD',
      headers: {
        'Referer':    pageUrl,
        'User-Agent': HEADERS['User-Agent']
      }
    });
    console.log('[KinoGer] Stream: ' + url);
  }
  return out;
}

// ── Sayfayı indir + stream'leri çıkar ──────────────────────
function fetchStreamsFromPage(pageUrl, title, seasonIndex, episodeIndex) {
  return fetch(pageUrl, { headers: HEADERS })
    .then(function (r) {
      if (!r.ok) throw new Error('Sayfa HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) {
      return extractStreamsFromPage(html, pageUrl, title, seasonIndex, episodeIndex);
    });
}

// ── Ana entry — Nuvio bu fonksiyonu çağırır ────────────────
//  @param {string}  tmdbId    — TMDB ID ("550" veya "1396:1:1" formatları)
//  @param {string}  mediaType — "movie" | "tv"
//  @param {number?} season    — 1-based (movie için null/0)
//  @param {number?} episode   — 1-based (movie için null/0)
//  @returns {Promise<Array>}  — Stream objeleri listesi
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[KinoGer] === Başlıyor | TMDB ' + tmdbId + ' | ' + mediaType + ' ===');

  var isTv        = mediaType === 'tv';
  // Dart: (tmdbId.season ?? 1) - 1
  var seasonIndex  = isTv ? ((season  || 1) - 1) : 0;
  var episodeIndex = isTv ? ((episode || 1) - 1) : 0;

  return fetchTmdbInfo(tmdbId, mediaType, 'de-DE')
    .then(function (info) {
      if (!info.name) {
        console.log('[KinoGer] TMDB başlık bulunamadı, durduruluyor');
        return [];
      }

      // Dart ile aynı başlık formatı:
      //   dizi:  "ShowName 1x5"
      //   film:  "MovieName (2023)"
      var title = isTv
        ? (info.name + ' ' + season + 'x' + episode)
        : (info.name + ' (' + info.year + ')');

      console.log('[KinoGer] Film: ' + info.name + ' (' + info.year + ')');

      return searchPageUrl(info.name, info.year).then(function (pageUrl) {
        if (!pageUrl) {
          console.log('[KinoGer] Sayfa bulunamadı, stream yok');
          return [];
        }
        return fetchStreamsFromPage(pageUrl, title, seasonIndex, episodeIndex);
      });
    })
    .catch(function (err) {
      console.error('[KinoGer] Hata: ' + (err && err.message ? err.message : err));
      return [];
    });
}

// ── Export (hem Node hem Hermes) ───────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
