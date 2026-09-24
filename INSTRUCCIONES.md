# Recibos de luz — RECIBOS_JARDIN (Google Sheets + Drive)

> **Estado (24 set 2026): instalada y publicada.**
> App: https://script.google.com/macros/s/AKfycbxEY9ZVcTbfzaIAUq2RZ9rxCzOClJ5bFNlilWnQVq-SLQydVvBnqoFzTkwgi0yiTq_J/exec
> El código se sube con **clasp** desde esta carpeta (`.clasp.json` apunta al proyecto). Para publicar cambios sin cambiar la URL:
> `clasp push --force` y luego `clasp deploy -i AKfycbxEY9ZVcTbfzaIAUq2RZ9rxCzOClJ5bFNlilWnQVq-SLQydVvBnqoFzTkwgi0yiTq_J`
> Los pasos manuales de abajo quedan como referencia por si hay que reinstalar a mano.

La app corre 100% en tu cuenta de Google: los datos en una Hoja de cálculo, los PDF y las fotos de medidores en Drive, y la app servida por Apps Script con su propia URL.

## Lo que ya está creado en tu Drive

```
RECIBOS_JARDIN/
├── RECIBOS_JARDIN — Datos        ← la Hoja de cálculo (vacía; setup la llena)
├── Recibos PDF/                  ← aquí caen los PDF que adjuntes en la app
├── Fotos medidores/
│   ├── Depto 1/  …  Depto 7/     ← historial de fotos de cada medidor
└── Código (pegar en Apps Script)/
    ├── Code.gs
    └── Datos.gs
```

El código ya apunta a esa Hoja y a esa carpeta por su ID: no hay que configurar nada.

## Lo que falta (unos 5 minutos, desde la computadora)

### 1. Abrir el editor de Apps Script desde la Hoja
1. Abre la Hoja **RECIBOS_JARDIN — Datos** (en la carpeta RECIBOS_JARDIN de tu Drive).
2. Menú **Extensiones → Apps Script**. Se abre el editor en otra pestaña.
3. Arriba, cambia "Proyecto sin título" por **RECIBOS_JARDIN**.

### 2. Pegar los 3 archivos
Usa los archivos de esta carpeta (`recibos-luz/`):

1. **Code.gs**: en el archivo `Código.gs` que ya aparece, borra todo, pega el contenido de **Code.gs** y guarda (Ctrl+S).
2. **Datos.gs**: haz clic en **+** (junto a "Archivos") → **Secuencia de comandos**, nómbralo `Datos`, pega el contenido de **Datos.gs** y guarda.
3. **index.html**: haz clic en **+** → **HTML**, nómbralo exactamente `index`, borra lo que trae, pega el contenido de **index.html** y guarda.

> ⚠️ El HTML debe llamarse `index`. Si no, al abrir la app verás "No se encontró el archivo HTML".

### 3. Cargar los datos
1. Junto a ▶️ **Ejecutar**, elige la función **`setup`** y presiona ▶️ **Ejecutar**.
2. Autoriza: **Revisar permisos → tu cuenta → Configuración avanzada → Ir a "RECIBOS_JARDIN" (no seguro) → Permitir**. El aviso "no seguro" es normal: aparece porque es un script tuyo, no publicado en una tienda.
3. En la Hoja aparecerán 4 pestañas (**recibos, departamentos, lecturas, config**) con tus datos.

Ejecutar `setup` dos veces no duplica nada.

### 4. Definir la contraseña de administrador
Se pide para **eliminar una lectura con cobros registrados** y para **reiniciar un historial de cobro**. Se guarda solo en Apps Script y nunca llega al navegador de nadie.

1. En el editor, barra izquierda: ⚙️ **Configuración del proyecto**.
2. Baja hasta **Propiedades de la secuencia de comandos → Agregar propiedad de la secuencia de comandos**.
3. **Propiedad:** `ADMIN_PASSWORD` (exactamente así). **Valor:** la contraseña que quieras. No uses tu correo ni la contraseña de Google.
4. **Guardar propiedades de la secuencia de comandos**.

Para cambiarla después, edita el valor ahí mismo; no hace falta volver a publicar. Tras 5 intentos fallidos, la app bloquea nuevos intentos por 10 minutos.

### 5. Publicar
1. **Implementar → Nueva implementación** → engranaje → **Aplicación web**.
2. **Ejecutar como:** Yo. **Quién tiene acceso:** "Cualquier usuario con una cuenta de Google" (recomendado).
3. **Implementar** y copia la **URL** (termina en `/exec`). Esa es tu app.
4. Ábrela en el celular y agrégala a la pantalla de inicio (en Chrome: menú ⋮ → **Agregar a la pantalla principal**).

---

## Fotos de medidores desde el celular

1. En la app: **Deptos** → toca el departamento → **Agregar lectura** → **Tomar/subir foto**.
2. **📷 Tomar foto** abre la cámara; **Elegir de la galería** sirve para fotos ya tomadas.
3. La app reduce la foto, lee los números del medidor y llena **Lectura actual**. Compáralo con la foto que aparece en pantalla y corrígelo si hace falta.
4. Al tocar **Guardar lectura**, la foto se guarda en Drive:
   `RECIBOS_JARDIN / Fotos medidores / Depto 3 / 2026-10 - Depto 3 - lectura 852.4.jpg`
5. En el historial del departamento, cada mes con foto muestra **📷 ver foto**.

**Consejos para que lea bien:** acércate hasta que los números llenen casi toda la foto, con buena luz y sin reflejos. La lectura se compara con la del mes anterior: si ningún número tiene sentido, la app no inventa uno y te pide escribirlo.

Si cambias una foto de un mes, la anterior se queda en la carpeta como respaldo.

## Volver a adjuntar los PDF

En la app, abre cada recibo → **Editar** → adjunta su PDF (desde `pdfs/`). Se guarda solo en `RECIBOS_JARDIN / Recibos PDF` con el nombre `Recibo 2026-03.pdf`, etc.

| Recibo | Archivo |
|---|---|
| Marzo 2026 | `MAR26.pdf` |
| Abril 2026 | `ABR26__2_.pdf` |
| Junio 2026 | `JUN26__3_.pdf` |
| Julio 2026 | `JUL26__1_.pdf` |
| Agosto 2026 | `AGO26__1_.pdf` |

---

## Si cambias el código más adelante

**Implementar → Gestionar implementaciones → ✏️ → Versión: "Nueva versión" → Implementar.** Si no lo haces, la URL sigue sirviendo la versión anterior. La URL no cambia.

## Preguntas frecuentes

**¿Se actualiza si otra persona edita al mismo tiempo?** Sí. La app revisa cambios cada ~7 segundos mientras está visible, y justo después de cada guardado. Si dos personas guardan a la vez, el script las pone en fila para que no se pisen.

**¿Tiene algún costo?** No. Sheets, Drive y Apps Script son gratis dentro de los límites de una cuenta personal.

**Aparece "No se pudo conectar con la Hoja de cálculo".** Revisa que hayas ejecutado `setup` y publicado una versión nueva después del último cambio.
