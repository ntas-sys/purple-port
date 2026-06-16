// ============================================================
//  VixSrc — Nuvio Provider
//  Port of: PlayTorrioV2/lib/webstreamr/source/vixsrc.dart
//
//  Kaynak: https://vixsrc.to  (İtalyan, çok dilli)
//  Mantık: URL builder — scrape yok. TMDB ID doğrudan URL'ye gömülür.
//    - Movie:  https://vixsrc.to/movie/{tmdbId}
//    - TV:     https://vixsrc.to/tv/{tmdbId}/{season}/{episode}
//
//  Bu bir "embed" sağlayıcıdır; Nuvio player URL'yi açar ve stream'i
//  oradan çıkarır. Cloudflare HTTP 200 veriyor, umut verici.
// ============================================================

var BASE_URL = 'https://vixsrc.to';

var TMDB_API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Referer': BASE_URL + '/'
};

// TMDB'den başlık+yıl çek (Dart getTmdbNameAndYear port — sadece title için)
function fetchTmdbInfo(tmdbId, mediaType, language) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url  = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId
           + '?api_key=' + TMDB_API_KEY
           + '&language=' + (language || 'en-US');
  return fetch(url)
    .then(function (r) { if (!r.ok) throw new Error('TMDB ' + r.status); return r.json(); })
    .then(function (d) {
      var isTv    = mediaType === 'tv';
      var name    = isTv ? (d.name || d.original_name || '') : (d.title || d.original_title || '');
      var dateStr = isTv ? d.first_air_date : d.release_date;
      var year    = dateStr ? parseInt(dateStr.slice(0, 4), 10) || 0 : 0;
      return { name: name, year: year };
    });
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

// Ana entry
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[VixSrc] === TMDB ' + tmdbId + ' | ' + mediaType + ' ===');

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function (info) {
      if (!info.name) return [];

      var isTv   = mediaType === 'tv';
      var title  = isTv
        ? (info.name + ' S' + pad2(season || 1) + 'E' + pad2(episode || 1))
        : (info.name + ' (' + info.year + ')');

      var url = isTv
        ? (BASE_URL + '/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1))
        : (BASE_URL + '/movie/' + tmdbId);

      console.log('[VixSrc] URL: ' + url);

      return [{
        name:    'VixSrc',
        title:   title,
        url:     url,
        quality: 'HD',
        headers: HEADERS
      }];
    })
    .catch(function (err) {
      console.error('[VixSrc] Hata: ' + (err && err.message ? err.message : err));
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
