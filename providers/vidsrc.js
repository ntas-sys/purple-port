// ============================================================
//  VidSrc — Nuvio Provider
//  Port of: PlayTorrioV2/lib/webstreamr/source/vidsrc.dart
//
//  Kaynak: https://vidsrc-embed.ru  (Çok dilli)
//  Mantık: URL builder — TMDB ID URL'ye gömülür.
//    - Movie:  https://vidsrc-embed.ru/embed/movie/{tmdbId}
//    - TV:     https://vidsrc-embed.ru/embed/tv/{tmdbId}/{season}-{episode}
//
//  Not: Dart kodu hem ImdbId hem TmdbId destekler; Nuvio hep TMDB verir.
// ============================================================

var BASE_URL = 'https://vidsrc-embed.ru';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Referer': BASE_URL + '/'
};

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[VidSrc] === TMDB ' + tmdbId + ' | ' + mediaType + ' ===');

  var isTv = mediaType === 'tv';
  var url  = isTv
    ? (BASE_URL + '/embed/tv/' + tmdbId + '/' + (season || 1) + '-' + (episode || 1))
    : (BASE_URL + '/embed/movie/' + tmdbId);

  console.log('[VidSrc] URL: ' + url);

  return Promise.resolve([{
    name:    'VidSrc',
    title:   isTv
      ? ('S' + (season || 1) + 'E' + (episode || 1))
      : 'Movie',
    url:     url,
    quality: 'HD',
    headers: HEADERS
  }]);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
