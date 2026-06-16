// ============================================================
//  extractors test — gerçek embed URL'leri ile dene
//  Project Hail Mary (TMDB 687163) için bulduğumuz URL'ler
// ============================================================

var ex = require('../extractors/extractors.js');

var TESTS = [
  // [host label, embed URL, referer]
  ['rgshows API',    'https://api.rgshows.ru/main/movie/687163', 'https://rgshows.ru/'],
  ['vide0.net (DoodStream)', 'https://vide0.net/e/18smzq58cyf5', 'https://einschalten.in/'],
  ['supervideo.cc',  'https://supervideo.cc/e/6vh9n2100ixe',    'https://mostraguarda.stream/'],
  ['dr0pstream',     'https://dr0pstream.com/e/s63ul1qph8w0',    'https://meinecloud.click/'],
  ['mixdrop.ag',     'https://mixdrop.ag/e/4dvnm1e7tq06rg',     'https://meinecloud.click/'],
  ['mixdrop.ag (2)', 'https://mixdrop.ag/e/7k9dexqdidwoped',    'https://verhdlink.cam/'],
  ['dood.to',        'https://dood.to/e/wdpzfhpex0tr',          'https://verhdlink.cam/'],
  ['vixsrc.to',      'https://vixsrc.to/movie/687163',          'https://vixsrc.to/'],
];

function runOne(item) {
  var label = item[0], url = item[1], ref = item[2];
  console.log('\n=== ' + label + ' ===');
  console.log('URL: ' + url);
  return ex.extractStream(url, ref)
    .then(function (streams) {
      if (streams.length === 0) {
        console.log('✗ 0 stream');
      } else {
        streams.forEach(function (s, i) {
          console.log('✓ [' + i + '] ' + s.format + ' | ' + (s.title || '') + ' | ' + s.url.slice(0, 120));
        });
      }
      return streams;
    })
    .catch(function (err) {
      console.log('✗ HATA: ' + (err && err.message ? err.message : err));
      return [];
    });
}

var i = 0;
function next() {
  if (i >= TESTS.length) { console.log('\n=== bitti ==='); return; }
  runOne(TESTS[i++]).then(next);
}
next();
