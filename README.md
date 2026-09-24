# Recibos de luz — Jardín

App web para llevar los recibos de luz (Luz del Sur) de un edificio y las lecturas de los medidores de cada departamento, con fotos desde el celular.

- **Interfaz:** `index.html`, publicada con GitHub Pages e instalable en el celular (`manifest.webmanifest`, `sw.js`).
- **Datos y archivos:** Google Apps Script (`Code.gs`) como API sobre una Hoja de cálculo y Google Drive. Se sube con [clasp](https://github.com/google/clasp).
- **Acceso:** código de acceso (`ACCESS_CODE`) y contraseña de administrador (`ADMIN_PASSWORD`), guardados en las Propiedades del script, nunca en este repositorio.

## Publicar cambios

```bash
node tools/revisar-html.js   # obligatorio: Apps Script corta los // dentro de textos del JS
clasp push --force
clasp deploy -i <deploymentId>   # mantiene la URL de la API
git push                         # actualiza GitHub Pages
```

Los datos personales (`Datos.gs`, `datos/`, `pdfs/`) están excluidos en `.gitignore`.
