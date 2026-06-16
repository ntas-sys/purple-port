#!/usr/bin/env node
// build-providers.js — Her provider'a extractor-bundle'ı inline gömer
//
//  Nuvio plugin'leri lokal require() yapamadığı için, extractors/extractor-bundle.js
//  içeriği her provider dosyasına kopyalanır. Provider'ın getStreams fonksiyonu
//  embed URL'leri döndüğü yerde extractAllStreams çağrılır.
//
//  Build adımları:
//    1) extractor-bundle.js içeriğini oku
//    2) Her provider dosyasını oku
//    3) Provider'ın getStreams dönüşünü extractAllStreams ile sarmala
//    4) Bundle içeriğini provider'ın sonuna ekle
//    5) providers-built/ altına kaydet

var fs = require('fs');
var path = require('path');

var PROVIDERS_DIR = path.join(__dirname, '..', 'providers');
var BUILT_DIR     = path.join(__dirname, '..', 'providers-built');
var BUNDLE_FILE   = path.join(__dirname, 'extractor-bundle.js');

// providers-built/ dizinini hazırla
if (!fs.existsSync(BUILT_DIR)) fs.mkdirSync(BUILT_DIR, { recursive: true });

var bundleSource = fs.readFileSync(BUNDLE_FILE, 'utf8');

// Bundle'ı "=== UNPACKER ===" kısmından başlat — unpacker, helpers, extractors dahil
var bundleBody = bundleSource.split('// === UNPACKER ===')[1] || bundleSource;
bundleBody = '// === UNPACKER ===' + bundleBody;
// Export kısmını kes
bundleBody = bundleBody.split('// Export')[0];

// Provider listesi — hangileri URL builder/scraper ise extractor entegrasyonu yapılacak
var PROVIDERS = [
  'vixsrc',      // URL builder → extractVixSrc
  'vidsrc',      // URL builder → extractVidSrc
  'rgshows',     // URL builder → extractRgShows
  'einschalten', // JSON API → extractDoodStream (vide0.net linki döner)
  'verhdlink',   // scraper → data-link (mixdrop/dood/vide0/supervideo)
  'mostraguarda',// scraper → data-link
  'frenchcloud', // scraper → data-link
  'meinecloud',  // scraper → data-link
  'cinehdplus',  // scraper → data-link (supervideo/dropload)
  'kinoger',     // scraper → .show() URL'leri
];

PROVIDERS.forEach(function (name) {
  var srcPath = path.join(PROVIDERS_DIR, name + '.js');
  var outPath = path.join(BUILT_DIR, name + '.js');

  if (!fs.existsSync(srcPath)) {
    console.log('[skip] ' + name + ' (dosya yok)');
    return;
  }

  var src = fs.readFileSync(srcPath, 'utf8');

  // Provider'ın getStreams fonksiyonunu bul
  // İmza: function getStreams(tmdbId, mediaType, season, episode) {
  // ...
  // }
  //
  // Strateji: Provider zaten stream objeleri dönüyor. Bu objelerin "url"
  // alanları embed URL'leri olabilir. extractAllStreams ile her birini
  // gerçek stream URL'lerine çevir.
  //
  // En basit yöntem: provider'ın getStreams dönüşünü sarmala.
  // Yeni getStreams: original getStreams → her stream.url için extractStream çağır
  //
  // Uygulanış:
  //   var _origGetStreams = getStreams;
  //   getStreams = function() {
  //     return _origGetStreams.apply(null, arguments).then(function(streams) {
  //       return extractAllStreams(streams.map(s => s.url), ...);
  //     });
  //   };

  // Wrap kodu
  // NOT: `var _origGetStreams` demiyoruz — bu IIFE local scope'unda kalır.
  // Direkt global `getStreams`'i yeniden atıyoruz (Nuvio'da function declaration
  // global scope'a çıkar, bu yüzden yeniden atama mümkün).
  var wrapper = '\n\n' +
    '// === EXTRACTOR INTEGRATION (auto-injected by build-providers.js) ===\n' +
    '// Provider\'ın döndürdüğü embed URL\'leri gerçek stream URL\'lerine çevir.\n' +
    '// getStreams fonksiyonunu sakla, sonra yeni wrapper ile değiştir.\n' +
    'var __origGetStreams_' + name + ' = getStreams;\n' +
    'getStreams = function (tmdbId, mediaType, season, episode) {\n' +
    '  return __origGetStreams_' + name + '(tmdbId, mediaType, season, episode)\n' +
    '    .then(function (streams) {\n' +
    '      if (!streams || streams.length === 0) return [];\n' +
    '      console.log(\'[extractor] ' + name + ': \' + streams.length + \' embed bulundu, extracting...\');\n' +
    '      var referer = (streams[0].headers && streams[0].headers.Referer)\n' +
    '                 || (streams[0].headers && streams[0].headers.referer)\n' +
    '                 || (typeof BASE_URL !== "undefined" ? BASE_URL : "");\n' +
    '      var embedUrls = streams.map(function (s) { return s.url; });\n' +
    '      var providerName = streams[0].name || \'' + name + '\';\n' +
    '      return extractAllStreams(embedUrls, referer, providerName);\n' +
    '    })\n' +
    '    .catch(function (err) {\n' +
    '      console.error(\'[extractor] ' + name + ' hata: \' + (err && err.message ? err.message : err));\n' +
    '      return [];\n' +
    '    });\n' +
    '};\n' +
    '\n' +
    '// === EXTRACTOR BUNDLE ===\n' +
    bundleBody;

  // Orijinal export bloğunu kaldır, wrapper + bundle'ı ekle, sonra YENİ export koy
  // Export regex: if (typeof module ... ) { module.exports = {...}; } else { global.getStreams = ...; }
  // Çok satırlı, greedy olmayan match
  var exportRegex = /if\s*\(typeof module[^)]*\)\s*\{[^]*?\}\s*else\s*\{[^]*?\}/;
  var newSrc;
  if (exportRegex.test(src)) {
    // Export'u kaldır
    var srcNoExport = src.replace(exportRegex, '').trim();
    // Wrapper + bundle + yeni export ekle
    newSrc = srcNoExport + wrapper +
      '\n// === EXPORT (auto-replaced — proxy üzerinden, wrapper\'ı çağırır) ===\n' +
      'function _getStreamsProxy() {\n' +
      '  return getStreams.apply(this, arguments);\n' +
      '}\n' +
      'if (typeof module !== "undefined" && module.exports) {\n' +
      '  module.exports = { getStreams: _getStreamsProxy };\n' +
      '} else {\n' +
      '  global.getStreams = _getStreamsProxy;\n' +
      '}\n';
  } else {
    newSrc = src + wrapper;
  }

  fs.writeFileSync(outPath, newSrc);
  console.log('[built] ' + name + '.js → providers-built/' + name + '.js');
});

console.log('\nTüm provider\'lar providers-built/ altına yazıldı.');
console.log('Nuvio\'ya providers-built/ içindeki dosyaları yükleyin.');
