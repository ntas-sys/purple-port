// ============================================================
//  Lokal test scripti — Nuvio app'e koymadan önce mantığı doğrula
//
//  Kullanım:
//    cd test
//    npm install cheerio-without-node-native   # ya da pnpm/yarn
//    node test-kinoger.js
//
//  NOT: Node v18+ önerilir (yerleşik fetch için). Eski Node'da
//  `npm install node-fetch` gerekir ve en üste `require` eklenir.
//
//  ÖNEMLİ: Bu lokal test kinoger.com'un Cloudflare korumasını
//  GEÇEMEZ (curl/Node TLS fingerprint'i Cloudflare'ye takılır).
//  Sunucudan 403 alırsanız bu BEKLENİR. Nuvio app içinde (mobil
//  cihaz UA + TLS) deneyin.
// ============================================================

var { getStreams } = require('../providers/kinoger.js');

// Test vakaları
var TESTS = [
  // [etiket, tmdbId, mediaType, season, episode]
  ['Film: Fight Club (1999)',       '550',    'movie', null, null],
  ['Film: Inception (2010)',        '27205',  'movie', null, null],
  ['Dizi: Breaking Bad S1E1',       '1396',   'tv',    1,    1],
  ['Dizi: Dark S1E1 (Alman)',       '70523',  'tv',    1,    1]
];

function runOne(label, tmdbId, mediaType, season, episode) {
  console.log('\n────────────────────────────────────────');
  console.log('▶ ' + label);
  console.log('────────────────────────────────────────');

  return getStreams(tmdbId, mediaType, season, episode)
    .then(function (streams) {
      console.log('\n✓ Sonuç: ' + streams.length + ' stream');
      streams.forEach(function (s, i) {
        console.log('  [' + i + '] ' + s.title + ' | ' + s.quality);
        console.log('      ' + s.url);
      });
      return streams;
    })
    .catch(function (err) {
      console.error('✗ Hata: ' + (err && err.message ? err.message : err));
      return [];
    });
}

// Sırayla çalıştır
function runAll() {
  var i = 0;
  function next() {
    if (i >= TESTS.length) {
      console.log('\n=== Tüm testler tamamlandı ===');
      return;
    }
    var t = TESTS[i++];
    runOne(t[0], t[1], t[2], t[3], t[4]).then(next);
  }
  next();
}

runAll();
