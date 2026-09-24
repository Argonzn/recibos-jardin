// Revisa index.html antes de publicar:
//  1) que cada <script> en línea tenga sintaxis válida;
//  2) que no haya "//" ni "/*" dentro de textos del JavaScript. Apps Script (HtmlService) borra
//     comentarios de forma ingenua y cortaría esos textos (p. ej. 'https://…'). Usar \/\/ y \/*.
// Uso: node tools/revisar-html.js   (sale con código 1 si encuentra problemas)
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let problemas = 0;

scripts.forEach((s, k) => {
  try { new Function(s); } catch (e) { problemas++; console.log(`script ${k}: error de sintaxis: ${e.message}`); }
  // Recorre el código saltando comentarios reales y buscando // o /* dentro de textos ('…', "…", `…`).
  let i = 0, linea = 1, enTexto = null;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '\n') linea++;
    if (enTexto) {
      if (c === '\\') { i += 2; continue; }
      if (c === enTexto) enTexto = null;
      else if ((c === '/' && (d === '/' || d === '*'))) { problemas++; console.log(`script ${k}, línea ${linea}: "${c}${d}" dentro de un texto → ${s.split('\n')[linea - 1].trim().slice(0, 100)}`); }
      i++; continue;
    }
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const f = s.indexOf('*/', i + 2); for (const ch of s.slice(i, f)) if (ch === '\n') linea++; i = f + 2; continue; }
    if (c === "'" || c === '"' || c === '`') enTexto = c;
    // Expresiones regulares literales: saltarlas para no confundir sus / con comentarios
    if (c === '/' && /[=(,:!&|?{};\[]\s*$/.test(s.slice(Math.max(0, i - 20), i))) {
      i++; while (i < s.length && s[i] !== '/') { if (s[i] === '\\') i++; else if (s[i] === '[') { while (s[i] !== ']') { if (s[i] === '\\') i++; i++; } } i++; }
    }
    i++;
  }
});
console.log(problemas ? `${problemas} problema(s)` : `OK: ${scripts.length} scripts sin problemas`);
process.exit(problemas ? 1 : 0);
