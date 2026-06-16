// Debug test 2
var fs = require('fs');
var html = fs.readFileSync('/tmp/drop2.html', 'utf8');

var m = html.match(/'((?:[^'\\\\]|\\\\.)+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\.split\('\|'\)/);
console.log('m[1] len:', m[1].length);

// Farklı unescape yöntemleri dene
var p1 = m[1].replace(/\\\\/g, '\\').replace(/\\'/g, "'").replace(/\\"/g, '"');
console.log('p1 (3-step) len:', p1.length);

var p2 = m[1].replace(/\\(.)/g, '$1');
console.log('p2 (single) len:', p2.length);

// İlk 200 karakter
console.log('m[1] ilk 200:', m[1].slice(0, 200));
console.log('p1 ilk 200:', p1.slice(0, 200));
console.log('p2 ilk 200:', p2.slice(0, 200));
