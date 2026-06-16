// ============================================================
//  MostraGuarda — Nuvio Provider
//  Port of: PlayTorrioV2/lib/webstreamr/source/mostraguarda.dart
//
//  Kaynak: https://mostraguarda.stream  (İtalyan)
//  Mantık: IMDb ID → film sayfası → [data-link] çıkart
//
//  verhdlink/française/meinecloud ile aynı pattern — sade versiyon:
//  tüm [data-link] elemanlarını tara, hostu kendi domain'iyse atla.
//  Sadece film.
// ============================================================

var BASE_URL = 'https://mostraguarda.stream';

var TMDB_API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

function fetchImdbId(tmdbId, mediaType) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url  = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId
           + '/external_ids?api_key=' + TMDB_API_KEY;
  return fetch(url)
    .then(function (r) { if (!r.ok) throw new Error('TMDB ' + r.status); return r.json(); })
    .then(function (d) { return d.imdb_id || ''; });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[MostraGuarda] === TMDB ' + tmdbId + ' | ' + mediaType + ' ===');

  if (mediaType !== 'movie') {
    console.log('[MostraGuarda] Sadece film');
    return Promise.resolve([]);
  }

  return fetchImdbId(tmdbId, mediaType)
    .then(function (imdbId) {
      if (!imdbId) return [];

      var pageUrl = BASE_URL + '/movie/' + imdbId;
      console.log('[MostraGuarda] Sayfa: ' + pageUrl);

      return fetch(pageUrl, { headers: HEADERS })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (html) {
          var cheerio = require('cheerio-without-node-native');
          var $ = cheerio.load(html);
          var out = [];

          $('[data-link]').each(function () {
            var raw = $(this).attr('data-link') || '';
            if (!raw) return;
            var fixed = raw.replace(/^(https?:)?\/\//, 'https://');
            if (fixed.indexOf('mostraguarda') !== -1) return;
            out.push({
              name:    'MostraGuarda',
              title:   'MostraGuarda',
              url:     fixed,
              quality: 'HD',
              headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL })
            });
            console.log('[MostraGuarda] ' + fixed);
          });
          return out;
        });
    })
    .catch(function (err) {
      console.error('[MostraGuarda] Hata: ' + (err && err.message ? err.message : err));
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
