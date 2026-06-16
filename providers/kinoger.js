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

// === EXTRACTOR INTEGRATION (auto-injected by build-providers.js) ===
// Provider'ın döndürdüğü embed URL'leri gerçek stream URL'lerine çevir.
// getStreams fonksiyonunu sakla, sonra yeni wrapper ile değiştir.
var __origGetStreams_kinoger = getStreams;
getStreams = function (tmdbId, mediaType, season, episode) {
  return __origGetStreams_kinoger(tmdbId, mediaType, season, episode)
    .then(function (streams) {
      if (!streams || streams.length === 0) return [];
      console.log('[extractor] kinoger: ' + streams.length + ' embed bulundu, extracting...');
      var referer = (streams[0].headers && streams[0].headers.Referer)
                 || (streams[0].headers && streams[0].headers.referer)
                 || (typeof BASE_URL !== "undefined" ? BASE_URL : "");
      var embedUrls = streams.map(function (s) { return s.url; });
      var providerName = streams[0].name || 'kinoger';
      return extractAllStreams(embedUrls, referer, providerName);
    })
    .catch(function (err) {
      console.error('[extractor] kinoger hata: ' + (err && err.message ? err.message : err));
      return [];
    });
};

// === EXTRACTOR BUNDLE ===
// === UNPACKER ===
function unpackEval(source) {
  var packRegex = /'((?:[^'\\\\]|\\\\.)+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\.split\('\|'\)/g;
  var bestM = null, m;
  while ((m = packRegex.exec(source)) !== null) {
    if (!bestM || m[1].length > bestM[1].length) bestM = m;
  }
  if (!bestM) throw new Error('No p,a,c,k,e,d');
  var payload = bestM[1].replace(/\\(.)/g, '$1');
  var radix = parseInt(bestM[2], 10);
  var count = parseInt(bestM[3], 10);
  var symtab = bestM[4].split('|');
  if (symtab.length !== count) throw new Error('Symtab mismatch');
  function unbase(word) {
    if (radix <= 10) return parseInt(word, radix).toString();
    var n = 0;
    for (var i = 0; i < word.length; i++) {
      var c = word.charCodeAt(i), d;
      if (c >= 48 && c <= 57) d = c - 48;
      else if (c >= 97 && c <= 122) d = c - 97 + 10;
      else if (c >= 65 && c <= 90) d = c - 65 + 36;
      else d = 0;
      n = n * radix + d;
    }
    return n.toString();
  }
  return payload.replace(/\b\w+\b/g, function (word) {
    var idx = parseInt(unbase(word), 10);
    if (isNaN(idx) || idx < 0 || idx >= count) return word;
    var repl = symtab[idx];
    return repl === '' ? word : repl;
  });
}

function extractUrlFromPacked(html, regexes) {
  var unpacked;
  try { unpacked = unpackEval(html); } catch (e) { unpacked = html; }
  for (var i = 0; i < regexes.length; i++) {
    var m = unpacked.match(regexes[i]);
    if (m && m[1]) return m[1].replace(/^\/\//, 'https://');
  }
  throw new Error('URL not found');
}

// === HTTP HELPERS ===
var MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36';

function fetchText(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
    return r.text();
  });
}

function fetchJson(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
    return r.json();
  });
}

function hostOf(url) { try { return new URL(url).host; } catch (e) { return ''; } }

// === EXTRACTOR FONKSİYONLARI ===

// VixSrc — token+expires+url regex, m3u8 playlist URL kur
function extractVixSrc(embedUrl, referer) {
  var headers = { 'Referer': embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    var tokenM   = html.match(/['"]token['"]\s*[:=]\s*['"]([^'"]+)['"]/);
    var expiresM = html.match(/['"]expires['"]\s*[:=]\s*['"]([^'"]+)['"]/);
    var urlM     = html.match(/url\s*[:=]\s*['"](https?:\/\/[^'"]+)['"]/)
              ||   html.match(/['"]url['"]\s*[:=]\s*['"](https?:\/\/[^'"]+)['"]/)
              ||   html.match(/(https?:\/\/[^'"\s]+\.mp4[^'"\s]*)/)
              ||   html.match(/(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/);
    if (!tokenM || !expiresM || !urlM) {
      console.log('[VixSrc] token/expires/url eksik (JS-rendered?)');
      return [];
    }
    var base = new URL(urlM[1]);
    var qp = new URLSearchParams(base.search);
    qp.set('token', tokenM[1]);
    qp.set('expires', expiresM[1]);
    qp.set('h', '1');
    return [{
      url: base.origin + base.pathname + '.m3u8?' + qp.toString(),
      format: 'hls', title: 'VixSrc',
      headers: { 'Referer': embedUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// RgShows — JSON API: data.stream.url direkt stream URL
function extractRgShows(embedUrl, referer) {
  var headers = { 'Referer': 'https://www.rgshows.ru/', 'Origin': 'https://www.rgshows.ru', 'User-Agent': 'Mozilla' };
  return fetchJson(embedUrl, headers).then(function (data) {
    if (!data || !data.stream || !data.stream.url) return [];
    var u = data.stream.url;
    var f = u.indexOf('.mp4') !== -1 ? 'mp4' : (u.indexOf('.m3u8') !== -1 || u.indexOf('.txt') !== -1 ? 'hls' : 'unknown');
    return [{ url: u, format: f, title: 'RgShows', headers: headers }];
  });
}

// VidSrc — iframe → rcp → src: → {v\d} → m3u8
function extractVidSrc(embedUrl, referer) {
  var headers = { 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    var cleaned = html.replace(/^<!--/, '').replace(/-->$/, '');
    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(cleaned);
    var iframeSrc = $('#player_iframe').attr('src') || '';
    if (!iframeSrc) { console.log('[VidSrc] iframe yok'); return []; }
    if (iframeSrc.indexOf('//') === 0) iframeSrc = 'https:' + iframeSrc;
    var iframeUrl = new URL(iframeSrc);
    var iframeOrigin = iframeUrl.origin;
    var title = ($('title').text() || '').trim();
    var results = [];
    var promises = [];
    $('.server[data-hash]').each(function () {
      var serverName = $(this).text().trim();
      var dataHash = $(this).attr('data-hash');
      if (serverName !== 'CloudStream Pro' || !dataHash) return;
      var rcpUrl = iframeOrigin + '/rcp/' + dataHash;
      promises.push(
        fetchText(rcpUrl, { 'Referer': iframeUrl.origin, 'User-Agent': MOBILE_UA })
          .then(function (iframeHtml) {
            var srcM = iframeHtml.match(/src:\s?'([^']+)'/);
            if (!srcM) return null;
            var playerUrl = srcM[1].indexOf('http') === 0 ? srcM[1] : iframeOrigin + srcM[1];
            return fetchText(playerUrl, { 'Referer': rcpUrl, 'User-Agent': MOBILE_UA })
              .then(function (playerHtml) {
                var fileM = playerHtml.match(/(https:\/\/.*?\{v\d\}.*?)\s+or/);
                if (!fileM) return null;
                var m3u8 = fileM[1].replace(/\{v\d\}/g, iframeUrl.host);
                return {
                  url: m3u8, format: 'hls',
                  title: title || 'VidSrc',
                  headers: { 'Referer': iframeUrl.toString(), 'User-Agent': MOBILE_UA }
                };
              });
          }).catch(function () { return null; })
      );
    });
    return Promise.all(promises).then(function (arr) {
      return arr.filter(function (x) { return x !== null; });
    });
  });
}

// SuperVideo — packed JS → sources:[{file:"...m3u8"}]
function extractSuperVideo(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (/The file was deleted|The file expired|Video is processing/.test(html)) return [];
    var playlistUrl;
    try { playlistUrl = extractUrlFromPacked(html, [/sources:\[\{file:"([^"]+)"/]); }
    catch (e) {
      var m = html.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/);
      if (!m) return [];
      playlistUrl = m[1];
    }
    if (!playlistUrl) return [];
    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('.download__title').text() || '').trim();
    return [{
      url: playlistUrl, format: 'hls',
      title: title || 'SuperVideo',
      headers: { 'Referer': 'https://supervideo.cc/', 'User-Agent': MOBILE_UA }
    }];
  });
}

// Dropload — packed JS
function extractDropload(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (html.indexOf('File Not Found') !== -1 || html.indexOf('Pending in queue') !== -1) return [];
    var playlistUrl;
    try { playlistUrl = extractUrlFromPacked(html, [/sources:\[\{file:"([^"]+)"/]); }
    catch (e) {
      var m = html.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/)
            || html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/);
      if (!m) return [];
      playlistUrl = m[1];
    }
    if (!playlistUrl) return [];
    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('.videoplayer h1').text() || '').trim();
    return [{
      url: playlistUrl, format: 'hls',
      title: title || 'Dropload',
      headers: { 'Referer': 'https://dr0pstream.com/', 'User-Agent': MOBILE_UA }
    }];
  });
}

// DoodStream — pass_md5 + token pattern (vide0.net, dood.to, ds2play vb.)
function extractDoodStream(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (html.indexOf('Video not found') !== -1) return [];
    var passM = html.match(/(\/pass_md5\/[^"'<>\s]+)/);
    if (!passM) { console.log('[DoodStream] pass_md5 yok'); return []; }
    var u = new URL(embedUrl);
    var doodHost = u.host;
    var passUrl = 'https://' + doodHost + passM[1];
    return fetchText(passUrl, { 'Referer': embedUrl, 'User-Agent': MOBILE_UA })
      .then(function (md5) {
        var tokenM = passM[1].match(/\/([^/]+)$/);
        var token = tokenM ? tokenM[1] : '';
        var expiry = Date.now() + 3600000;
        var mp4Url = md5 + token + '?token=' + token + '&expiry=' + expiry;
        var cheerio = require('cheerio-without-node-native');
        var $ = cheerio.load(html);
        var title = ($('title').text() || '').replace(/ - DoodStream$/, '').trim();
        return [{
          url: mp4Url, format: 'mp4',
          title: title || 'DoodStream',
          headers: { 'Referer': 'https://' + doodHost + '/', 'User-Agent': MOBILE_UA }
        }];
      });
  });
}

// Mixdrop — /e/ sayfasında pack → MDCore.wurl
function extractMixdrop(embedUrl, referer) {
  var eUrl = embedUrl.replace('/f/', '/e/');
  var headers = { 'Referer': referer || eUrl, 'User-Agent': MOBILE_UA };
  return fetchText(eUrl, headers).then(function (html) {
    if (/can't find the (file|video)/.test(html)) return [];
    var unpacked;
    try { unpacked = unpackEval(html); } catch (e) { unpacked = html; }
    var urlM = unpacked.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/)
            || unpacked.match(/MDCore\.vurl\s*=\s*["']([^"']+)["']/)
            || unpacked.match(/sources:\[\{file:"([^"]+)"/);
    if (!urlM) { console.log('[Mixdrop] wurl/vurl yok'); return []; }
    var streamUrl = urlM[1];
    if (streamUrl.indexOf('//') === 0) streamUrl = 'https:' + streamUrl;
    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('.title b').text() || $('title').text() || '').trim()
                  .replace(/^MixDrop - Watch\s+/, '').trim();
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : (streamUrl.indexOf('.mp4') !== -1 ? 'mp4' : 'unknown');
    return [{
      url: streamUrl, format: format,
      title: title || 'Mixdrop',
      headers: { 'Referer': eUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// Vidora — packed JS
function extractVidora(embedUrl, referer) {
  var headers = { 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('title').text() || '').replace(/^Watch\s+/, '').trim();
    var m3u8;
    try { m3u8 = extractUrlFromPacked(html, [/file:\s?"([^"]+)"/]); }
    catch (e) {
      var m = html.match(/file:\s?["']([^"']+)["']/);
      if (!m) return [];
      m3u8 = m[1];
    }
    var u = new URL(embedUrl);
    return [{
      url: m3u8, format: 'hls',
      title: title || 'Vidora',
      headers: { 'Origin': u.origin, 'User-Agent': MOBILE_UA }
    }];
  });
}

// FileLions / VidHide — packed JS
function extractFileLions(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (html.indexOf('File Not Found') !== -1) return [];
    var unpacked;
    try { unpacked = unpackEval(html); } catch (e) { unpacked = html; }
    var m = unpacked.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/)
         || unpacked.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/);
    if (!m) { console.log('[FileLions] sources yok'); return []; }
    var streamUrl = m[1];
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';
    return [{
      url: streamUrl, format: format, title: 'FileLions',
      headers: { 'Referer': embedUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// LuluStream
function extractLuluStream(embedUrl, referer) {
  var fileUrl = embedUrl.replace('/e/', '/d/');
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(fileUrl, headers).then(function (html) {
    if (/No such file|File Not Found/.test(html)) return [];
    var m = html.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/)
         || html.match(/"file":\s*"([^"]+)"/);
    if (!m) { console.log('[LuluStream] sources yok'); return []; }
    var streamUrl = m[1];
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';
    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('h1').text() || '').trim();
    return [{
      url: streamUrl, format: format, title: title || 'LuluStream',
      headers: { 'Referer': fileUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// Uqload — packed JS
function extractUqload(embedUrl, referer) {
  var headers = { 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (html.indexOf('File Not Found') !== -1) return [];
    var unpacked;
    try { unpacked = unpackEval(html); } catch (e) { unpacked = html; }
    var m = unpacked.match(/sources:\s*\[\s*["']([^"']+)["']/)
         || unpacked.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/);
    if (!m) { console.log('[Uqload] sources yok'); return []; }
    var streamUrl = m[1];
    if (streamUrl.indexOf('//') === 0) streamUrl = 'https:' + streamUrl;
    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('h1').text() || '').trim();
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';
    return [{
      url: streamUrl, format: format, title: title || 'Uqload',
      headers: { 'Referer': embedUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// Voe — redirect + sources regex
function extractVoe(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    var redirectM = html.match(/window\.location\.href\s*=\s*'([^']+)/);
    if (redirectM) return extractVoe(redirectM[1], referer);
    if (html.indexOf('An error occurred during encoding') !== -1) return [];
    var m = html.match(/"sources":\s*\[\s*\{\s*"file":\s*"([^"]+)"/)
         || html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/)
         || html.match(/mp4["']?\s*:\s*["']([^"']+\.mp4[^"']*)["']/)
         || html.match(/m3u8["']?\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);
    if (!m) { console.log('[Voe] sources yok'); return []; }
    var streamUrl = m[1];
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';
    return [{
      url: streamUrl, format: format, title: 'VOE',
      headers: { 'Referer': embedUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// Streamtape
function extractStreamtape(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  var vUrl = embedUrl.replace('/e/', '/v/');
  return fetchText(vUrl, headers).then(function (html) {
    var srcM = html.match(/'([^']*\/[^']*\.(?:mp4|m3u8)[^']*)'/);
    if (!srcM) { console.log('[Streamtape] URL yok (anti-bot)'); return []; }
    var streamUrl = srcM[1];
    if (streamUrl.indexOf('//') === 0) streamUrl = 'https:' + streamUrl;
    return [{
      url: streamUrl, format: 'mp4', title: 'Streamtape',
      headers: { 'Referer': vUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// FileMoon — iframe recursive + packed
function extractFileMoon(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  var dUrl = embedUrl.replace('/e/', '/d/');
  return fetchText(dUrl, headers).then(function (html) {
    if (html.indexOf('Page not found') !== -1) return [];
    var iframeM = html.match(/iframe[^>]*src=["']([^"']+)["']/g);
    if (iframeM && iframeM.length > 0) {
      var lastSrc = iframeM[iframeM.length - 1].match(/src=["']([^"']+)["']/);
      if (lastSrc && lastSrc[1].indexOf('http') === 0) {
        return extractFileMoon(lastSrc[1], dUrl);
      }
    }
    var unpacked;
    try { unpacked = unpackEval(html); } catch (e) { unpacked = html; }
    var m = unpacked.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/)
         || unpacked.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/);
    if (!m) { console.log('[FileMoon] sources yok'); return []; }
    var streamUrl = m[1];
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';
    return [{
      url: streamUrl, format: format, title: 'FileMoon',
      headers: { 'Referer': dUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// HubCloud
function extractHubCloud(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    var urlM = html.match(/var url ?= ?'(.*?)'/);
    if (!urlM) return [];
    var linksUrl = urlM[1];
    return fetchText(linksUrl, { 'Referer': embedUrl, 'User-Agent': MOBILE_UA })
      .then(function (linksHtml) {
        var cheerio = require('cheerio-without-node-native');
        var $ = cheerio.load(linksHtml);
        var title = ($('title').text() || '').trim();
        var out = [];
        $('a').each(function () {
          var text = $(this).text();
          var href = $(this).attr('href') || '';
          if (!href) return;
          if (text.indexOf('PixelServer') !== -1) {
            var apiUrl = href.replace('/u/', '/api/file/');
            apiUrl += (apiUrl.indexOf('?') === -1 ? '?download=' : '&download=');
            out.push({
              url: apiUrl, format: 'unknown',
              title: title + ' (PixelServer)',
              headers: { 'Referer': href, 'User-Agent': MOBILE_UA }
            });
          } else if (text.indexOf('FSL') !== -1) {
            out.push({
              url: href, format: 'unknown',
              title: title + ' (' + text.trim() + ')',
              headers: { 'Referer': linksUrl, 'User-Agent': MOBILE_UA }
            });
          }
        });
        return out;
      });
  });
}

// === DISPATCHER ===
function extractStream(embedUrl, referer) {
  if (!embedUrl) return Promise.resolve([]);
  var host = hostOf(embedUrl);
  console.log('[extractStream] host=' + host + ' url=' + embedUrl);

  try {
    if (host.indexOf('vixsrc') !== -1) return extractVixSrc(embedUrl, referer);
    if (host.indexOf('rgshows') !== -1) return extractRgShows(embedUrl, referer);
    if (/vidsrc|vsrc/.test(host)) return extractVidSrc(embedUrl, referer);
    if (host.indexOf('supervideo') !== -1) return extractSuperVideo(embedUrl, referer);
    if (/dropload|dr0pstream/.test(host)) return extractDropload(embedUrl, referer);
    if (/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s/.test(host))
      return extractDoodStream(embedUrl, referer);
    if (/mixdrop|mixdrp|mixdroop|m1xdrop/.test(host)) return extractMixdrop(embedUrl, referer);
    if (host.indexOf('vidora') !== -1) return extractVidora(embedUrl, referer);
    if (/.*lions?/.test(host) || /vidhide/.test(host)) return extractFileLions(embedUrl, referer);
    if (host.indexOf('lulu') !== -1 || host === 'cdn1.site' || host === 'd00ds.site') return extractLuluStream(embedUrl, referer);
    if (host.indexOf('uqload') !== -1) return extractUqload(embedUrl, referer);
    if (host.indexOf('voe') !== -1) return extractVoe(embedUrl, referer);
    if (host.indexOf('streamtape') !== -1 || host.indexOf('strtape') !== -1 || host.indexOf('strcloud') !== -1 || host.indexOf('stape') !== -1)
      return extractStreamtape(embedUrl, referer);
    if (host.indexOf('filemoon') !== -1) return extractFileMoon(embedUrl, referer);
    if (host.indexOf('hubcloud') !== -1 || host.indexOf('vcloud') !== -1) return extractHubCloud(embedUrl, referer);
    if (host.indexOf('hubdrive') !== -1) return extractHubCloud(embedUrl, referer);
  } catch (e) {
    console.log('[extractStream] hata: ' + e.message);
    return Promise.resolve([]);
  }

  // Bilinmeyen host: orijinal URL'i external olarak dön
  console.log('[extractStream] bilinmeyen host: ' + host + ' — external olarak dön');
  return Promise.resolve([{
    url: embedUrl, format: 'unknown',
    title: host,
    headers: { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA }
  }]);
}

// Birden fazla embed URL'i paralel extract et, tek dizi döndür
// [embedUrls] — string array
// [referer] — extraction sırasında referer olarak kullanılacak
// [providerName] — stream objelerinin "name" alanı için
function extractAllStreams(embedUrls, referer, providerName) {
  var promises = embedUrls.map(function (url) {
    return extractStream(url, referer).then(function (streams) {
      // Stream objelerine provider adını ekle
      return streams.map(function (s) {
        s.name = providerName || s.name || 'Stream';
        return s;
      });
    }).catch(function (err) {
      console.log('[extractAllStreams] hata: ' + err.message);
      return [];
    });
  });
  return Promise.all(promises).then(function (results) {
    var all = [];
    results.forEach(function (arr) {
      arr.forEach(function (s) { all.push(s); });
    });
    return all;
  });
}


// === EXPORT (auto-replaced — proxy üzerinden, wrapper'ı çağırır) ===
function _getStreamsProxy() {
  return getStreams.apply(this, arguments);
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: _getStreamsProxy };
} else {
  global.getStreams = _getStreamsProxy;
}
