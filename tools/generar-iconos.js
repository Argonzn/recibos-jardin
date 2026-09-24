// Genera los íconos PNG de la app (rayo ámbar sobre fondo oscuro) sin dependencias externas.
// Uso: node tools/generar-iconos.js  → escribe icons/icon-192.png, icon-512.png, apple-touch-icon.png
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const FONDO = [0x12, 0x17, 0x1d], RAYO = [0xf0, 0xb4, 0x29];
// Rayo en coordenadas 0..1, centrado dentro de la zona segura de íconos "maskable" (80 % central).
const POLIGONO = [[0.56, 0.18], [0.30, 0.55], [0.47, 0.55], [0.42, 0.82], [0.70, 0.43], [0.53, 0.43], [0.60, 0.18]];

function dentro(x, y, pol) {
  let c = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [xi, yi] = pol[i], [xj, yj] = pol[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(tipo, datos) {
  const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(tam) {
  const SS = 4; // supermuestreo 4×4 para bordes suaves
  const filas = [];
  for (let y = 0; y < tam; y++) {
    const fila = Buffer.alloc(1 + tam * 3); // byte de filtro 0 + RGB
    for (let x = 0; x < tam; x++) {
      let n = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++)
        if (dentro((x + (sx + 0.5) / SS) / tam, (y + (sy + 0.5) / SS) / tam, POLIGONO)) n++;
      const a = n / (SS * SS);
      for (let k = 0; k < 3; k++) fila[1 + x * 3 + k] = Math.round(FONDO[k] * (1 - a) + RAYO[k] * a);
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(filas))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const [nombre, tam] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(dir, nombre), png(tam));
  console.log(nombre, tam + 'px');
}
