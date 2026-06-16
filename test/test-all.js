// ============================================================
//  Tüm provider'ları lokal test et
//
//  Kullanım:
//    cd test
//    npm install
//    node test-all.js
//
//  Not: Cloudflare'li siteler Node'da 403 verebilir (beklenen).
//  Buradaki amaç syntax + akış doğrulamasıdır.
// ============================================================

var PROVIDERS = [
  // [id, file, tmdbId, mediaType, season, episode, açıklama]
  ['vixsrc',       '../providers/vixsrc.js',       '550',    'movie', null, null, 'Fight Club'],
  ['vixsrc',       '../providers/vixsrc.js',       '1396',   'tv',    1,    1,    'Breaking Bad S1E1'],
  ['vidsrc',       '../providers/vidsrc.js',       '550',    'movie', null, null, 'Fight Club'],
  ['vidsrc',       '../providers/vidsrc.js',       '1396',   'tv',    1,    1,    'Breaking Bad S1E1'],
  ['rgshows',      '../providers/rgshows.js',      '550',    'movie', null, null, 'Fight Club'],
  ['rgshows',      '../providers/rgshows.js',      '1396',   'tv',    1,    1,    'Breaking Bad S1E1'],
  ['einschalten',  '../providers/einschalten.js',  '550',    'movie', null, null, 'Fight Club'],
  ['einschalten',  '../providers/einschalten.js',  '27205',  'movie', null, null, 'Inception'],
  ['verhdlink',    '../providers/verhdlink.js',    '550',    'movie', null, null, 'Fight Club'],
  ['mostraguarda', '../providers/mostraguarda.js', '550',    'movie', null, null, 'Fight Club'],
  ['frenchcloud',  '../providers/frenchcloud.js',  '550',    'movie', null, null, 'Fight Club'],
  ['meinecloud',   '../providers/meinecloud.js',   '550',    'movie', null, null, 'Fight Club'],
  ['cinehdplus',   '../providers/cinehdplus.js',   '1396',   'tv',    1,    1,    'Breaking Bad S1E1'],
  ['kinoger',      '../providers/kinoger.js',      '550',    'movie', null, null, 'Fight Club (CF li)'],
];

function runOne(item) {
  var id = item[0], file = item[1], tmdbId = item[2], mediaType = item[3],
      season = item[4], episode = item[5], desc = item[6];

  var mod = require(file);
  return mod.getStreams(tmdbId, mediaType, season, episode)
    .then(function (streams) {
      var status = streams.length > 0 ? '✓ ' + streams.length + ' stream' : '○ 0 stream';
      console.log('[' + id + '] ' + desc + ' → ' + status);
      streams.slice(0, 3).forEach(function (s, i) {
        console.log('    [' + i + '] ' + (s.title || '') + ' | ' + s.url.slice(0, 100));
      });
      return { id: id, count: streams.length, ok: true };
    })
    .catch(function (err) {
      console.log('[' + id + '] ' + desc + ' → ✗ HATA: ' + (err && err.message ? err.message : err));
      return { id: id, count: 0, ok: false };
    });
}

function runAll() {
  var results = [];
  var i = 0;
  function next() {
    if (i >= PROVIDERS.length) {
      console.log('\n=== ÖZET ===');
      var byId = {};
      results.forEach(function (r) {
        if (!byId[r.id]) byId[r.id] = { total: 0, streams: 0, errors: 0 };
        byId[r.id].total++;
        if (!r.ok) byId[r.id].errors++;
        else byId[r.id].streams += r.count;
      });
      Object.keys(byId).forEach(function (k) {
        var s = byId[k];
        console.log('  ' + k.padEnd(15) + ' | ' + s.total + ' test | ' + s.streams + ' stream | ' + s.errors + ' hata');
      });
      return;
    }
    var item = PROVIDERS[i++];
    process.stdout.write('.');
    runOne(item).then(function (r) {
      results.push(r);
      next();
    });
  }
  console.log('=== Test başlıyor ===');
  next();
}

runAll();
