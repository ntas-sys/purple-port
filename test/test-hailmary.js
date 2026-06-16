// Project Hail Mary (TMDB 687163) — tüm provider'ları test et
var TESTS = [
  ['vixsrc',       '../providers-built/vixsrc.js',       '687163', 'movie', null, null],
  ['vidsrc',       '../providers-built/vidsrc.js',       '687163', 'movie', null, null],
  ['rgshows',      '../providers-built/rgshows.js',      '687163', 'movie', null, null],
  ['einschalten',  '../providers-built/einschalten.js',  '687163', 'movie', null, null],
  ['verhdlink',    '../providers-built/verhdlink.js',    '687163', 'movie', null, null],
  ['mostraguarda', '../providers-built/mostraguarda.js', '687163', 'movie', null, null],
  ['frenchcloud',  '../providers-built/frenchcloud.js',  '687163', 'movie', null, null],
  ['meinecloud',   '../providers-built/meinecloud.js',   '687163', 'movie', null, null],
  ['cinehdplus',   '../providers-built/cinehdplus.js',   '687163', 'movie', null, null],
  ['kinoger',      '../providers-built/kinoger.js',      '687163', 'movie', null, null],
];

function runOne(t) {
  var name = t[0], file = t[1], tmdbId = t[2], mediaType = t[3], season = t[4], episode = t[5];
  console.log('\n=== ' + name + ' ===');
  var mod = require(file);
  return mod.getStreams(tmdbId, mediaType, season, episode)
    .then(function (streams) {
      console.log('  streams: ' + streams.length);
      streams.slice(0, 5).forEach(function (s, i) {
        console.log('  [' + i + '] ' + (s.format || '?') + ' | ' + (s.title || '') + ' | ' + s.url.slice(0, 100));
      });
      return streams.length;
    })
    .catch(function (err) {
      console.log('  ✗ HATA: ' + (err && err.message ? err.message : err));
      return 0;
    });
}

var i = 0, total = 0;
function next() {
  if (i >= TESTS.length) {
    console.log('\n=== TOPLAM: ' + total + ' stream ===');
    return;
  }
  runOne(TESTS[i++]).then(function (n) {
    total += n;
    next();
  });
}
next();
