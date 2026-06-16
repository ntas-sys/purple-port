// ============================================================
//  CineHDPlus — Nuvio Provider
//  Port of: PlayTorrioV2/lib/webstreamr/source/cinehdplus.dart
//
//  Kaynak: https://cinehdplus.gratis  (İspanyol/Latin — es, mx)
//  Mantık (SADECE DİZİ / TV):
//    1) Site içi arama: /series/?story={tmdbId}&do=search&subaction=search
//    2) İlk .card__title a[href] sonucunu al → seri sayfası
//    3) Sayfada [data-num="SxEy"] elemanlarını bul (sezon x bölüm)
//    4) Her birinin .mirrors altındaki [data-link]'leri çıkar
//    5) Latino/Castellano etiketi: .details__langs içeriğine bak
//
//  Dizi sitesi olduğu için supportedTypes: ["tv"] only.
// ============================================================

var BASE_URL = 'https://cinehdplus.gratis';

var TMDB_API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── 1. Arama yap, seri sayfası URL'sini bul ────────────────
function fetchSeriesPageUrl(tmdbId) {
  var searchUrl = BASE_URL + '/series/?story=' + encodeURIComponent(tmdbId)
                + '&do=search&subaction=search';
  console.log('[CineHDPlus] Arama: ' + searchUrl);

  return fetch(searchUrl, { headers: HEADERS })
    .then(function (r) {
      if (!r.ok) throw new Error('Arama HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) {
      var cheerio = require('cheerio-without-node-native');
      var $ = cheerio.load(html);
      var href = $('.card__title a[href]').first().attr('href') || '';
      if (!href) {
        console.log('[CineHDPlus] Seri bulunamadı');
        return null;
      }
      // Göreli ise mutlak yap
      if (href.indexOf('http') !== 0) {
        href = BASE_URL + (href.charAt(0) === '/' ? '' : '/') + href;
      }
      console.log('[CineHDPlus] Seri sayfası: ' + href);
      return href;
    });
}

// ── 2. Seri sayfasından sezon/bölüm mirror'larını çıkar ────
function extractEpisodeStreams(html, pageUrl, season, episode) {
  var cheerio = require('cheerio-without-node-native');
  var $ = cheerio.load(html);

  // Dil tespiti: .details__langs içeriği "Latino" içeriyor mu?
  var langsHtml = $('.details__langs').html() || '';
  var label     = langsHtml.indexOf('Latino') !== -1 ? 'Latino' : 'Castellano';

  // og:title meta'sından başlık al
  var ogTitle = $('meta[property="og:title"]').attr('content') || '';
  ogTitle     = ogTitle.trim();

  var title     = ogTitle + ' S' + season + 'E' + episode + ' ' + label;
  var dataNum   = season + 'x' + episode;  // Dart: '${tmdbId.season}x${tmdbId.episode}'
  var out       = [];

  console.log('[CineHDPlus] data-num="' + dataNum + '" aranıyor, dil=' + label);

  $('[data-num="' + dataNum + '"]').each(function () {
    var mirrors = $(this).parent().find('.mirrors');
    if (!mirrors || mirrors.length === 0) return;

    mirrors.find('[data-link]').each(function () {
      var raw = $(this).attr('data-link') || '';
      if (!raw) return;
      var fixed = raw.replace(/^(https?:)?\/\//, 'https://');
      if (fixed.indexOf('cinehdplus') !== -1) return;

      out.push({
        name:    'CineHDPlus',
        title:   title,
        url:     fixed,
        quality: 'HD',
        headers: Object.assign({}, HEADERS, { 'Referer': pageUrl })
      });
      console.log('[CineHDPlus] Stream: ' + fixed);
    });
  });

  return out;
}

// ── Ana entry ──────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[CineHDPlus] === TMDB ' + tmdbId + ' | ' + mediaType + ' ===');

  // Sadece dizi (Dart: contentTypes: ['series'])
  if (mediaType !== 'tv') {
    console.log('[CineHDPlus] Sadece tv / dizi');
    return Promise.resolve([]);
  }

  if (!season || !episode) {
    console.log('[CineHDPlus] Sezon/bölüm gerekli');
    return Promise.resolve([]);
  }

  return fetchSeriesPageUrl(tmdbId)
    .then(function (pageUrl) {
      if (!pageUrl) return [];

      return fetch(pageUrl, { headers: HEADERS })
        .then(function (r) {
          if (!r.ok) throw new Error('Sayfa HTTP ' + r.status);
          return r.text();
        })
        .then(function (html) {
          return extractEpisodeStreams(html, pageUrl, season, episode);
        });
    })
    .catch(function (err) {
      console.error('[CineHDPlus] Hata: ' + (err && err.message ? err.message : err));
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
