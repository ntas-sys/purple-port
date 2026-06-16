// ============================================================
//  VerHdLink — Nuvio Provider
//  Port of: PlayTorrioV2/lib/webstreamr/source/verhdlink.dart
//
//  Kaynak: https://verhdlink.cam  (İspanyol/Latin — es, mx)
//  Mantık: IMDb ID → film sayfası → cheerio ile data-link çıkart
//
//  Önemli fark: sadece "_player-mirrors" blokları içindekileri alır.
//  Latino (mx) ve Castellano (es) sınıfına göre etiketler.
//  Sadece film (movie).
// ============================================================

var BASE_URL = 'https://verhdlink.cam';

var TMDB_API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// TMDB → IMDb ID çevir (Dart getImdbId port)
function fetchImdbId(tmdbId, mediaType) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url  = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId
           + '/external_ids?api_key=' + TMDB_API_KEY;
  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('TMDB external_ids ' + r.status);
      return r.json();
    })
    .then(function (d) { return d.imdb_id || ''; });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[VerHdLink] === TMDB ' + tmdbId + ' | ' + mediaType + ' ===');

  if (mediaType !== 'movie') {
    console.log('[VerHdLink] Sadece film');
    return Promise.resolve([]);
  }

  return fetchImdbId(tmdbId, mediaType)
    .then(function (imdbId) {
      if (!imdbId) {
        console.log('[VerHdLink] IMDb ID bulunamadı');
        return [];
      }
      var pageUrl = BASE_URL + '/movie/' + imdbId;
      console.log('[VerHdLink] Sayfa: ' + pageUrl);

      return fetch(pageUrl, { headers: HEADERS })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (html) {
          var cheerio = require('cheerio-without-node-native');
          var $ = cheerio.load(html);
          var out = [];

          // ._player-mirrors altındaki [data-link]'leri tara
          $('._player-mirrors').each(function () {
            var classes    = ($(this).attr('class') || '').split(/\s+/);
            var isLatino   = classes.indexOf('latino')     !== -1;
            var isCastel   = classes.indexOf('castellano') !== -1;
            if (!isLatino && !isCastel) return;  // Dart: continue

            var label = isLatino ? 'Latino' : 'Castellano';

            $(this).find('[data-link]').each(function () {
              var raw = $(this).attr('data-link') || '';
              if (!raw) return;

              // Dart: replaceFirst(RegExp(r'^(https:)?//'), 'https://')
              var fixed = raw.replace(/^(https?:)?\/\//, 'https://');

              // verhdlink host'lu linkleri atla
              if (fixed.indexOf('verhdlink') !== -1) return;

              out.push({
                name:    'VerHdLink',
                title:   'VerHdLink ' + label,
                url:     fixed,
                quality: 'HD',
                headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL })
              });
              console.log('[VerHdLink] ' + label + ': ' + fixed);
            });
          });

          return out;
        });
    })
    .catch(function (err) {
      console.error('[VerHdLink] Hata: ' + (err && err.message ? err.message : err));
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
