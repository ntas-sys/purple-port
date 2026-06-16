// Debug test
var fs = require('fs');
var html = fs.readFileSync('/tmp/drop2.html', 'utf8');

function unpackEval(source) {
  var m = source.match(
    /'((?:[^'\\\\]|\\\\.)+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\.split\('\|'\)/
  );
  if (!m) throw new Error('No pack');
  var payload = m[1].replace(/\\(.)/g, '$1');
  var radix   = parseInt(m[2], 10);
  var count   = parseInt(m[3], 10);
  var symtab  = m[4].split('|');
  if (symtab.length !== count) throw new Error('Symtab mismatch');
  function unbase(word) {
    if (radix <= 10) return parseInt(word, radix).toString();
    var n = 0;
    for (var i = 0; i < word.length; i++) {
      var c = word.charCodeAt(i);
      var d;
      if (c >= 48 && c <= 57)       d = c - 48;
      else if (c >= 97 && c <= 122) d = c - 97 + 10;
      else if (c >= 65 && c <= 90)  d = c - 65 + 36;
      else                          d = 0;
      n = n * radix + d;
    }
    return n.toString();
  }
  return payload.replace(/\b\w+\b/g, function (word) {
    var idx = parseInt(unbase(word), 10);
    if (isNaN(idx) || idx < 0 || idx >= count) return word;
    var repl = symtab[idx];
    return repl === '' ? word : repl;
  });
}

var u = unpackEval(html);
console.log('inline result len:', u.length);
console.log('ilk 300:', u.slice(0, 300));
