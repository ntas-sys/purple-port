// ============================================================
//  unpacker.js — packed JS (p,a,c,k,e,r) çözücü
//
//  Port of: PlayTorrioV2/lib/webstreamr/utils/unpacker.dart
//            (which itself is a port of the `unpacker` npm package)
//
//  Supervideo/Dropload/Vidora/FileMoon/FileLions/LuluStream gibi
//  hostlar eval(function(p,a,c,k,e,d){...}(...)) şeklinde paketlenmiş
//  JS kullanır. Bu fonksiyon paketi açar ve düz JS metni döndürür;
//  çağıran kod regex ile stream URL'sini çıkarır.
// ============================================================

// Paketlenmiş JS'i aç. İlk p,a,c,k,e,d bloğunu bulur.
// [source] paketlenmiş JS içeren HTML metni.
// Dönüş: açılmış JS metni (hala JS — URL'yi regex ile çıkarmalısın).
function unpackEval(source) {
  // Pack formatları:
  //   Format A: }('payload',radix,count,'symtab'.split('|'),0,{})
  //   Format B: ('payload',radix,count,'symtab'.split('|'))  (dr0pstream)
  //   Format C: }('payload',radix,count,'symtab'.split('|'),0)
  // Birden fazla pack olabilir — en uzun olanı seç
  var packRegex = /'((?:[^'\\\\]|\\\\.)+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\.split\('\|'\)/g;
  var bestM = null;
  var m;
  while ((m = packRegex.exec(source)) !== null) {
    if (!bestM || m[1].length > bestM[1].length) bestM = m;
  }
  if (!bestM) throw new Error('No p,a,c,k,e,d string found');

  var payload = _unescape(bestM[1]);
  var radix   = parseInt(bestM[2], 10);
  var count   = parseInt(bestM[3], 10);
  var symtab  = bestM[4].split('|');

  if (symtab.length !== count) {
    throw new Error('Symtab length mismatch (' + count + ' vs ' + symtab.length + ')');
  }

  function unbase(word) {
    if (radix <= 10) return parseInt(word, radix).toString();
    var n = 0;
    for (var i = 0; i < word.length; i++) {
      var c = word.charCodeAt(i);
      var d;
      if (c >= 48 && c <= 57)      d = c - 48;       // 0-9
      else if (c >= 97 && c <= 122) d = c - 97 + 10; // a-z
      else if (c >= 65 && c <= 90)  d = c - 65 + 36; // A-Z
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

function _unescape(s) {
  return s
    .replace(/\\\\/g, '\\')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}

// Pack açıldıktan sonra regex listesini sırayla dene, ilk eşleşeni dön.
// [html] orijinal HTML (pack açılmamış hali)
// [regexes] denenecek RegExp dizisi
function extractUrlFromPacked(html, regexes) {
  var unpacked;
  try { unpacked = unpackEval(html); }
  catch (e) {
    // Pack bulunamazsa orijinal HTML'i kullan (bazı hostlar artık pack kullanmıyor)
    unpacked = html;
  }

  for (var i = 0; i < regexes.length; i++) {
    var m = unpacked.match(regexes[i]);
    if (m && m[1]) {
      var url = m[1].replace(/^\/\//, 'https://');
      return url;
    }
  }
  throw new Error('URL not found in packed JS');
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    unpackEval:            unpackEval,
    extractUrlFromPacked:  extractUrlFromPacked
  };
} else {
  global.unpackEval           = unpackEval;
  global.extractUrlFromPacked = extractUrlFromPacked;
}
