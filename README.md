# Recibos de luz — Jardín

App web para repartir los recibos de luz (Luz del Sur) y agua (Sedapal) de un edificio entre sus departamentos, con lecturas de medidores (fotos desde el celular), cobros y una vista de solo lectura para cada inquilino.

- **Interfaz:** `index.html`, publicada con GitHub Pages e instalable en el celular (`manifest.webmanifest`, `sw.js`).
- **Datos y archivos:** Google Apps Script (`Code.gs`) como API sobre una Hoja de cálculo y Google Drive. Se sube con [clasp](https://github.com/google/clasp).
- **Acceso:** código de acceso (`ACCESS_CODE`) y contraseña de administrador (`ADMIN_PASSWORD`), guardados en las Propiedades del script, nunca en este repositorio.

## Publicar cambios

```bash
bash tools/publicar.sh "Descripción del cambio"   # revisa el HTML, clasp push + deploy (misma URL) y git push
```

Guía de uso completa: [INSTRUCCIONES.md](INSTRUCCIONES.md).

Los datos personales (`Datos.gs`, `datos/`, `pdfs/`) están excluidos en `.gitignore`.
