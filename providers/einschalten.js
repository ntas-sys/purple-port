// ============================================================
//  Einschalten — Nuvio Provider
//  Port of: PlayTorrioV2/lib/webstreamr/source/einschalten.dart
//
//  Kaynak: https://einschalten.in  (Alman)
//  Mantık: JSON API çağrısı → stream URL'si döner
//    GET https://einschalten.in/api/movies/{tmdbId}/watch
//    → { releaseName, streamUrl }
//
//  Sadece film (movie). HTTP 200 döndü, umut verici.
// ============================================================

var BASE_URL = 'https://einschalten.in';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Einschalten] === TMDB ' + tmdbId + ' | ' + mediaType + ' ===');

  // Sadece film desteklenir (Dart contentTypes: ['movie'])
  if (mediaType !== 'movie') {
    console.log('[Einschalten] Sadece film, tv değil');
    return Promise.resolve([]);
  }

  var apiUrl = BASE_URL + '/api/movies/' + tmdbId + '/watch';
  console.log('[Einschalten] API: ' + apiUrl);

  return fetch(apiUrl, { headers: HEADERS })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.streamUrl) {
        console.log('[Einschalten] streamUrl yok');
        return [];
      }

      var title = data.releaseName || ('TMDB ' + tmdbId);
      var referer = BASE_URL + '/movies/' + tmdbId;

      return [{
        name:    'Einschalten',
        title:   title,
        url:     data.streamUrl,
        quality: 'HD',
        headers: Object.assign({}, HEADERS, { 'Referer': referer })
      }];
    })
    .catch(function (err) {
      console.error('[Einschalten] Hata: ' + (err && err.message ? err.message : err));
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
