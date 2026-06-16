// Debug: dr0pstream extraction
var fs = require('fs');
var ex = require('../extractors/extractors.js');

// Dropload extractor fonksiyonunu patch'leyip debug ekleyelim
var html = fs.readFileSync('/tmp/drop2.html', 'utf8');
console.log('html length:', html.length);

// Pack'leri say
var packRegex = /'((?:[^'\\\\]|\\\\.)+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\.split\('\|'\)/g;
var m, i = 0;
while ((m = packRegex.exec(html)) !== null) {
  i++;
  console.log('Pack #' + i + ': payload len=' + m[1].length + ' radix=' + m[2] + ' count=' + m[3]);
}
console.log('total packs:', i);

// unpackEval çağır
try {
  var u = ex.unpackEval(html);
  console.log('\nunpackEval result len:', u.length);
  console.log('ilk 500:', u.slice(0, 500));
  // sources ara
  var s = u.match(/sources:\[\{file:"([^"]+)"/);
  console.log('sources:', s ? s[1] : 'YOK');
} catch (e) { console.log('err:', e.message); }
