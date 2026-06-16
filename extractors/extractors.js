// ============================================================
//  extractors.js — Tüm host extractor'ları tek dosyada
//
//  Port of: PlayTorrioV2/lib/webstreamr/extractor/*.dart
//
//  Mimari:
//    - Provider'lar "embed URL" döndürür (örn: https://dood.to/e/abc)
//    - extractStream(embedUrl, referer) → gerçek stream URL'leri
//
//  PlayTorrioV2'de bu ayrı bir ExtractorRegistry katmanıydı.
//  Nuvio'da plugin başına tek dosya sınırlaması olduğu için, tüm
//  extractor'ları bu bundle'a topladık. Provider'lar bu dosyayı
//  require edemez (Nuvio sadece cheerio/crypto-js/axios destekler),
//  bu yüzden provider yazarken bu fonksiyonları provider'a kopyalayın.
//
//  Lokal test için kullanım:
//    var ex = require('../extractors/extractors.js');
//    var streams = ex.extractStreams('https://dood.to/e/abc', 'https://source.com');
// ============================================================

// ── unpacker (inline — provider'a kopyalanacak) ────────────
function unpackEval(source) {
  // Pack formatları:
  //   Format A: }('payload',radix,count,'symtab'.split('|'),0,{})
  //   Format B: ('payload',radix,count,'symtab'.split('|'))  (dr0pstream)
  //   Format C: }('payload',radix,count,'symtab'.split('|'),0)
  // Payload içinde \\' ve \\' kaçışları olabilir, bu yüzden (?:[^'\\\\]|\\\\.)+ kullanırız
  // Birden fazla pack olabilir (dr0pstream: biri audio, biri video) — en uzun olanı seç
  var packRegex = /'((?:[^'\\\\]|\\\\.)+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\.split\('\|'\)/g;
  var bestM = null;
  var m;
  while ((m = packRegex.exec(source)) !== null) {
    if (!bestM || m[1].length > bestM[1].length) bestM = m;
  }
  if (!bestM) throw new Error('No p,a,c,k,e,d string found');
  m = bestM;
  // Payload içindeki \X kaçışlarını çöz: \\ → \, \' → ', \" → "
  // Tek replace kullan (ardışık replace bozukluğu olmasın)
  var payload = m[1].replace(/\\(.)/g, '$1');
  var radix   = parseInt(m[2], 10);
  var count   = parseInt(m[3], 10);
  var symtab  = m[4].split('|');
  if (symtab.length !== count) throw new Error('Symtab length mismatch');

  function unbase(word) {
    if (radix <= 10) return parseInt(word, radix).toString();
    var n = 0;
    for (var i = 0; i < word.length; i++) {
      var c = word.charCodeAt(i);
      var d;
      if (c >= 48 && c <= 57)       d = c - 48;
      else if (c >= 97 && c <= 122) d = c - 97 + 10;
      else if (c >= 65 && c <= 90)  d = c - 65 + 36;
      else                          d = 0;
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
  throw new Error('URL not found in packed JS');
}

// ── HTTP helpers ───────────────────────────────────────────
var MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36';

function fetchText(url, headers) {
  return fetch(url, { headers: headers || {} })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
      return r.text();
    });
}

function fetchJson(url, headers) {
  return fetch(url, { headers: headers || {} })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
      return r.json();
    });
}

function hostOf(url) { try { return new URL(url).host; } catch (e) { return ''; } }

// host pattern eşleşmesi
function hostMatches(url, pattern) {
  var h = hostOf(url);
  if (!h) return false;
  if (pattern instanceof RegExp) return pattern.test(h);
  return h.indexOf(pattern) !== -1;
}

// ============================================================
//  EXTRACTOR FONKSİYONLARI
//  Hepsi: (embedUrl, referer) → Promise<[{url, format, headers, title}]>
//  format: 'hls' | 'mp4' | 'unknown'
// ============================================================

// ── VixSrc ─────────────────────────────────────────────────
//  extractor/vixsrc.dart port
//  HTML'den token+expires+url regex ile çek, m3u8 playlist URL'si kur.
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
      console.log('[VixSrc] token/expires/url eksik — sayfa JS-rendered olabilir');
      return [];
    }

    var base     = urlM[1];
    var baseU    = new URL(base);
    var qp       = new URLSearchParams(baseU.search);
    qp.set('token',   tokenM[1]);
    qp.set('expires', expiresM[1]);
    qp.set('h', '1');
    var playlistUrl = baseU.origin + baseU.pathname + '.m3u8?' + qp.toString();

    return [{
      url:     playlistUrl,
      format:  'hls',
      title:   'VixSrc',
      headers: { 'Referer': embedUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── RgShows ────────────────────────────────────────────────
//  extractor/rgshows.dart port
//  JSON API: data.stream.url direkt stream URL'si.
function extractRgShows(embedUrl, referer) {
  var headers = {
    'Referer':    'https://www.rgshows.ru/',
    'Origin':     'https://www.rgshows.ru',
    'User-Agent': 'Mozilla'
  };
  return fetchJson(embedUrl, headers).then(function (data) {
    if (!data || !data.stream || !data.stream.url) {
      console.log('[RgShows] stream.url yok');
      return [];
    }
    var streamUrl = data.stream.url;
    var format    = streamUrl.indexOf('.mp4') !== -1 ? 'mp4'
                  : (streamUrl.indexOf('.m3u8') !== -1 || streamUrl.indexOf('.txt') !== -1 ? 'hls' : 'unknown');
    return [{
      url:     streamUrl,
      format:  format,
      title:   'RgShows',
      headers: headers
    }];
  });
}

// ── VidSrc ─────────────────────────────────────────────────
//  extractor/vidsrc.dart port (basitleştirilmiş)
//  iframe → rcp/{hash} → src: → {v\d} → m3u8
function extractVidSrc(embedUrl, referer) {
  var headers = { 'User-Agent': MOBILE_UA };

  return fetchText(embedUrl, headers).then(function (html) {
    // HTML comment wrapper'ı temizle
    var cleaned = html.replace(/^<!--/, '').replace(/-->$/, '');
    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(cleaned);

    var iframeSrc = $('#player_iframe').attr('src') || '';
    if (!iframeSrc) {
      console.log('[VidSrc] #player_iframe src yok');
      return [];
    }
    if (iframeSrc.indexOf('//') === 0) iframeSrc = 'https:' + iframeSrc;

    var iframeUrl    = new URL(iframeSrc);
    var iframeOrigin = iframeUrl.origin;
    var title        = ($('title').text() || '').trim();

    var results = [];

    // .server[data-hash] elemanlarını tara
    var serverEls = $('.server[data-hash]');
    if (serverEls.length === 0) {
      console.log('[VidSrc] .server[data-hash] yok');
      return [];
    }

    var promises = [];
    serverEls.each(function () {
      var serverName = $(this).text().trim();
      var dataHash   = $(this).attr('data-hash');
      if (serverName !== 'CloudStream Pro' || !dataHash) return;

      var rcpUrl = iframeOrigin + '/rcp/' + dataHash;
      var p = fetchText(rcpUrl, { 'Referer': iframeUrl.origin, 'User-Agent': MOBILE_UA })
        .then(function (iframeHtml) {
          var srcM = iframeHtml.match(/src:\s?'([^']+)'/);
          if (!srcM) return null;
          var playerUrl = srcM[1].indexOf('http') === 0
            ? srcM[1]
            : iframeOrigin + srcM[1];

          return fetchText(playerUrl, { 'Referer': rcpUrl, 'User-Agent': MOBILE_UA })
            .then(function (playerHtml) {
              var fileM = playerHtml.match(/(https:\/\/.*?\{v\d\}.*?)\s+or/);
              if (!fileM) return null;
              var m3u8 = fileM[1].replace(/\{v\d\}/g, iframeUrl.host);
              return {
                url:     m3u8,
                format:  'hls',
                title:   title || 'VidSrc',
                headers: { 'Referer': iframeUrl.toString(), 'User-Agent': MOBILE_UA }
              };
            });
        })
        .catch(function () { return null; });

      promises.push(p);
    });

    return Promise.all(promises).then(function (arr) {
      return arr.filter(function (x) { return x !== null; });
    });
  });
}

// ── SuperVideo ─────────────────────────────────────────────
//  extractor/supervideo.dart port
//  Packed JS → sources:[{file:"...m3u8"}]
function extractSuperVideo(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (/The file was deleted|The file expired|Video is processing/.test(html)) return [];

    var playlistUrl;
    try {
      playlistUrl = extractUrlFromPacked(html, [/sources:\[\{file:"([^"]+)"/]);
    } catch (e) {
      var m = html.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/);
      if (!m) return [];
      playlistUrl = m[1];
    }
    if (!playlistUrl) return [];

    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('.download__title').text() || '').trim();

    return [{
      url:     playlistUrl,
      format:  'hls',
      title:   title || 'SuperVideo',
      headers: { 'Referer': 'https://supervideo.cc/', 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── Dropload (dr0pstream) ──────────────────────────────────
//  extractor/dropload.dart port
function extractDropload(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (html.indexOf('File Not Found') !== -1 || html.indexOf('Pending in queue') !== -1) return [];

    var playlistUrl;
    try {
      playlistUrl = extractUrlFromPacked(html, [/sources:\[\{file:"([^"]+)"/]);
    } catch (e) {
      var m = html.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/)
            || html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/)
            || html.match(/["']([^"']+\.m3u8[^"']*)["']/);
      if (!m) return [];
      playlistUrl = m[1];
    }
    if (!playlistUrl) return [];

    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('.videoplayer h1').text() || '').trim();

    return [{
      url:     playlistUrl,
      format:  'hls',
      title:   title || 'Dropload',
      headers: { 'Referer': 'https://dr0pstream.com/', 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── DoodStream (dood.to, vide0.net, ds2play vb.) ───────────
//  extractor/doodstream.dart port (MFP gerekmeden, basitleştirilmiş)
//  DoodStream pass_md5 + timestamp + token pattern ile mp4 URL'si kurar.
function extractDoodStream(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };

  return fetchText(embedUrl, headers).then(function (html) {
    if (html.indexOf('Video not found') !== -1) return [];

    // /e/{id} → /pass_md5/{id}/{hash}
    var passM = html.match(/(\/pass_md5\/[^"'<>\s]+)/);
    if (!passM) {
      console.log('[DoodStream] pass_md5 bulunamadı');
      return [];
    }

    // Domain'i embedUrl'den çıkar
    var u = new URL(embedUrl);
    var doodHost = u.host;
    var passUrl = 'https://' + doodHost + passM[1];

    return fetchText(passUrl, { 'Referer': embedUrl, 'User-Agent': MOBILE_UA })
      .then(function (md5) {
        // Hash'in son kısmını al (token)
        var tokenM = passM[1].match(/\/([^/]+)$/);
        var token  = tokenM ? tokenM[1] : '';

        // DoodStream URL pattern: {md5}{token}?token={token}&expiry={expiry}
        // expiry = şu anki timestamp * 1000 + random
        var expiry = Date.now() + 3600000;
        var mp4Url = md5 + token + '?token=' + token + '&expiry=' + expiry;

        var cheerio = require('cheerio-without-node-native');
        var $ = cheerio.load(html);
        var title = ($('title').text() || '').replace(/ - DoodStream$/, '').trim();

        return [{
          url:     mp4Url,
          format:  'mp4',
          title:   title || 'DoodStream',
          headers: { 'Referer': 'https://' + doodHost + '/', 'User-Agent': MOBILE_UA }
        }];
      });
  });
}

// ── Mixdrop ────────────────────────────────────────────────
//  extractor/mixdrop.dart port (düzeltme: pack /e/ sayfasında, /f/ değil)
//  /e/ URL'i pack içerir → MDCore.wurl = "..."
function extractMixdrop(embedUrl, referer) {
  // /f/ → /e/ dönüşümü (bazı provider'lar /f/ veriyor)
  var eUrl = embedUrl.replace('/f/', '/e/');
  var headers = { 'Referer': referer || eUrl, 'User-Agent': MOBILE_UA };

  return fetchText(eUrl, headers).then(function (html) {
    if (/can't find the (file|video)/.test(html)) return [];

    // unpacked JS içinde MDCore.wurl="..." veya eval(pack)
    var unpacked;
    try { unpacked = unpackEval(html); }
    catch (e) { unpacked = html; }

    var urlM = unpacked.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/)
            || unpacked.match(/MDCore\.vurl\s*=\s*["']([^"']+)["']/)
            || unpacked.match(/sources:\[\{file:"([^"]+)"/);

    if (!urlM) {
      console.log('[Mixdrop] wurl/vurl/sources bulunamadı');
      return [];
    }

    var streamUrl = urlM[1];
    if (streamUrl.indexOf('//') === 0) streamUrl = 'https:' + streamUrl;

    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('.title b').text() || $('title').text() || '').trim()
                  .replace(/^MixDrop - Watch\s+/, '').trim();

    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls'
               : (streamUrl.indexOf('.mp4') !== -1 ? 'mp4' : 'unknown');

    return [{
      url:     streamUrl,
      format:  format,
      title:   title || 'Mixdrop',
      headers: { 'Referer': eUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── Vidora ─────────────────────────────────────────────────
//  extractor/vidora.dart port
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
      url:     m3u8,
      format:  'hls',
      title:   title || 'Vidora',
      headers: { 'Origin': u.origin, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── FileLions / VidHide ────────────────────────────────────
//  extractor/filelions.dart port (basitleştirilmiş — MFP gerektirmeden)
function extractFileLions(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (html.indexOf('File Not Found') !== -1) return [];

    var unpacked;
    try { unpacked = unpackEval(html); }
    catch (e) { unpacked = html; }

    var m = unpacked.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/)
         || unpacked.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/);

    if (!m) {
      console.log('[FileLions] sources/file bulunamadı');
      return [];
    }

    var streamUrl = m[1];
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';

    return [{
      url:     streamUrl,
      format:  format,
      title:   'FileLions',
      headers: { 'Referer': embedUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── Lulustream ─────────────────────────────────────────────
//  extractor/lulustream.dart port (basitleştirilmiş)
function extractLuluStream(embedUrl, referer) {
  // /e/ → /d/ indir
  var fileUrl = embedUrl.replace('/e/', '/d/');
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };

  return fetchText(fileUrl, headers).then(function (html) {
    if (/No such file|File Not Found/.test(html)) return [];

    var m = html.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/)
         || html.match(/"file":\s*"([^"]+)"/);

    if (!m) {
      console.log('[LuluStream] sources bulunamadı');
      return [];
    }

    var streamUrl = m[1];
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';

    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('h1').text() || '').trim();

    return [{
      url:     streamUrl,
      format:  format,
      title:   title || 'LuluStream',
      headers: { 'Referer': fileUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── Uqload ─────────────────────────────────────────────────
//  extractor/uqload.dart port
function extractUqload(embedUrl, referer) {
  var headers = { 'User-Agent': MOBILE_UA };
  return fetchText(embedUrl, headers).then(function (html) {
    if (html.indexOf('File Not Found') !== -1) return [];

    var unpacked;
    try { unpacked = unpackEval(html); }
    catch (e) { unpacked = html; }

    var m = unpacked.match(/sources:\s*\[\s*["']([^"']+)["']/)
         || unpacked.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/);

    if (!m) {
      console.log('[Uqload] sources bulunamadı');
      return [];
    }

    var streamUrl = m[1];
    if (streamUrl.indexOf('//') === 0) streamUrl = 'https:' + streamUrl;

    var cheerio = require('cheerio-without-node-native');
    var $ = cheerio.load(html);
    var title = ($('h1').text() || '').trim();
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';

    return [{
      url:     streamUrl,
      format:  format,
      title:   title || 'Uqload',
      headers: { 'Referer': embedUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── Voe ────────────────────────────────────────────────────
//  extractor/voe.dart port (basitleştirilmiş)
function extractVoe(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };

  return fetchText(embedUrl, headers).then(function (html) {
    // window.location.href = '...' redirect varsa takip et
    var redirectM = html.match(/window\.location\.href\s*=\s*'([^']+)/);
    if (redirectM) {
      return extractVoe(redirectM[1], referer);
    }
    if (html.indexOf('An error occurred during encoding') !== -1) return [];

    // VOE: <script>var hayl = [...]</script> veya JSON içinde sources
    var m = html.match(/"sources":\s*\[\s*\{\s*"file":\s*"([^"]+)"/)
         || html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/)
         || html.match(/mp4["']?\s*:\s*["']([^"']+\.mp4[^"']*)["']/)
         || html.match(/m3u8["']?\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);

    if (!m) {
      console.log('[Voe] sources bulunamadı');
      return [];
    }

    var streamUrl = m[1];
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';

    return [{
      url:     streamUrl,
      format:  format,
      title:   'VOE',
      headers: { 'Referer': embedUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── Streamtape ─────────────────────────────────────────────
//  extractor/streamtape.dart port (basitleştirilmiş)
//  Streamtape robot-proof: id=xxx&expires=yyy token + sayfa içi base64 regex
function extractStreamtape(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  // /e/ → /v/ (video sayfası)
  var vUrl = embedUrl.replace('/e/', '/v/');

  return fetchText(vUrl, headers).then(function (html) {
    // "ideoonum" or "ngodesources" obfuscation: 'id' + base64
    var m = html.match(/id=([^&"']+&expires=[^&"'<]+)/)
         || html.match(/get_/);

    // Streamtape genelde: document.getElementById('ideoonum').innerHTML = ...
    // ya da: ngodesources = '//streamtape.../.../...mp4'
    var srcM = html.match(/'([^']*\/[^']*\.(?:mp4|m3u8)[^']*)'/);

    if (!srcM) {
      console.log('[Streamtape] stream URL bulunamadı (anti-bot)');
      return [];
    }

    var streamUrl = srcM[1];
    if (streamUrl.indexOf('//') === 0) streamUrl = 'https:' + streamUrl;

    return [{
      url:     streamUrl,
      format:  'mp4',
      title:   'Streamtape',
      headers: { 'Referer': vUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── FileMoon ───────────────────────────────────────────────
//  extractor/filemoon.dart port (basitleştirilmiş)
function extractFileMoon(embedUrl, referer) {
  var headers = { 'Referer': referer || embedUrl, 'User-Agent': MOBILE_UA };
  // /e/ → /d/
  var dUrl = embedUrl.replace('/e/', '/d/');

  return fetchText(dUrl, headers).then(function (html) {
    if (html.indexOf('Page not found') !== -1) return [];

    // iframe recursive: son iframe src al
    var iframeM = html.match(/iframe[^>]*src=["']([^"']+)["']/g);
    if (iframeM && iframeM.length > 0) {
      var lastSrc = iframeM[iframeM.length - 1].match(/src=["']([^"']+)["']/);
      if (lastSrc && lastSrc[1].indexOf('http') === 0) {
        return extractFileMoon(lastSrc[1], dUrl);
      }
    }

    var unpacked;
    try { unpacked = unpackEval(html); }
    catch (e) { unpacked = html; }

    var m = unpacked.match(/sources:\s*\[\s*\{\s*file:\s*"([^"]+)"/)
         || unpacked.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/);

    if (!m) {
      console.log('[FileMoon] sources bulunamadı');
      return [];
    }

    var streamUrl = m[1];
    var format = streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4';

    return [{
      url:     streamUrl,
      format:  format,
      title:   'FileMoon',
      headers: { 'Referer': dUrl, 'User-Agent': MOBILE_UA }
    }];
  });
}

// ── HubCloud / HubDrive ────────────────────────────────────
//  extractor/hubcloud.dart port (basitleştirilmiş)
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

          // PixelServer linklerini işle
          if (text.indexOf('PixelServer') !== -1) {
            var apiUrl = href.replace('/u/', '/api/file/');
            if (apiUrl.indexOf('?') === -1) apiUrl += '?download=';
            else apiUrl += '&download=';
            out.push({
              url:     apiUrl,
              format:  'unknown',
              title:   title + ' (PixelServer)',
              headers: { 'Referer': href, 'User-Agent': MOBILE_UA }
            });
          } else if (text.indexOf('FSL') !== -1) {
            out.push({
              url:     href,
              format:  'unknown',
              title:   title + ' (' + text.trim() + ')',
              headers: { 'Referer': linksUrl, 'User-Agent': MOBILE_UA }
            });
          }
        });

        return out;
      });
  });
}

// ============================================================
//  DISPATCHER — embed URL'sine göre doğru extractor'u çağır
// ============================================================
function extractStream(embedUrl, referer) {
  if (!embedUrl) return Promise.resolve([]);
  var host = hostOf(embedUrl);
  console.log('[extractStream] host=' + host + ' url=' + embedUrl);

  try {
    if (host.indexOf('vixsrc') !== -1)        return extractVixSrc(embedUrl, referer);
    if (host.indexOf('rgshows') !== -1)       return extractRgShows(embedUrl, referer);
    if (/vidsrc|vsrc/.test(host))             return extractVidSrc(embedUrl, referer);
    if (host.indexOf('supervideo') !== -1)    return extractSuperVideo(embedUrl, referer);
    if (/dropload|dr0pstream/.test(host))     return extractDropload(embedUrl, referer);
    if (/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s/.test(host))
                                              return extractDoodStream(embedUrl, referer);
    if (/mixdrop|mixdrp|mixdroop|m1xdrop/.test(host))
                                              return extractMixdrop(embedUrl, referer);
    if (host.indexOf('vidora') !== -1)        return extractVidora(embedUrl, referer);
    if (/.*lions?/.test(host) || /vidhide/.test(host))
                                              return extractFileLions(embedUrl, referer);
    if (host.indexOf('lulu') !== -1 || host === 'cdn1.site' || host === 'd00ds.site')
                                              return extractLuluStream(embedUrl, referer);
    if (host.indexOf('uqload') !== -1)        return extractUqload(embedUrl, referer);
    if (host.indexOf('voe') !== -1)           return extractVoe(embedUrl, referer);
    if (host.indexOf('streamtape') !== -1 || host.indexOf('strtape') !== -1 || host.indexOf('strcloud') !== -1 || host.indexOf('stape') !== -1)
                                              return extractStreamtape(embedUrl, referer);
    if (host.indexOf('filemoon') !== -1)      return extractFileMoon(embedUrl, referer);
    if (host.indexOf('hubcloud') !== -1 || host.indexOf('vcloud') !== -1)
                                              return extractHubCloud(embedUrl, referer);
    if (host.indexOf('hubdrive') !== -1)      return extractHubCloud(embedUrl, referer); // hubdrive → hubcloud'a yönlendir
  } catch (e) {
    console.log('[extractStream] hata: ' + e.message);
    return Promise.resolve([]);
  }

  // Bilinmeyen host: boş dön
  console.log('[extractStream] bilinmeyen host: ' + host);
  return Promise.resolve([]);
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    unpackEval:           unpackEval,
    extractUrlFromPacked: extractUrlFromPacked,
    extractStream:        extractStream,
    extractVixSrc:        extractVixSrc,
    extractRgShows:       extractRgShows,
    extractVidSrc:        extractVidSrc,
    extractSuperVideo:    extractSuperVideo,
    extractDropload:      extractDropload,
    extractDoodStream:    extractDoodStream,
    extractMixdrop:       extractMixdrop,
    extractVidora:        extractVidora,
    extractFileLions:     extractFileLions,
    extractLuluStream:    extractLuluStream,
    extractUqload:        extractUqload,
    extractVoe:           extractVoe,
    extractStreamtape:    extractStreamtape,
    extractFileMoon:      extractFileMoon,
    extractHubCloud:      extractHubCloud
  };
} else {
  global.extractStream        = extractStream;
  global.unpackEval           = unpackEval;
  global.extractUrlFromPacked = extractUrlFromPacked;
}
