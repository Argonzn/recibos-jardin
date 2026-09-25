# Recibos Jardín — guía de uso

App para repartir los recibos de **luz (Luz del Sur)** y **agua (Sedapal)** del edificio entre los departamentos, registrar las lecturas de los medidores con fotos y llevar los cobros.

- **App:** https://argonzn.github.io/recibos-jardin/ (se puede instalar en el celular: menú ⋮ → *Agregar a la pantalla principal*).
- **Datos:** Hoja de cálculo *RECIBOS_JARDIN — Datos* en Google Drive. PDF y fotos en la carpeta *RECIBOS_JARDIN*.

## Quién entra y cómo

| Quién | Código | Qué puede hacer |
|---|---|---|
| Administración | `ACCESS_CODE` (Propiedades del script) | Todo |
| Cada inquilino | Su propio código de 6 letras | Solo ver su cuenta: lo que debe, cómo se calculó, sus pagos y fotos |

Los códigos de inquilino se crean en **Deptos → (depto) → 🔑 Acceso del inquilino**. Cambiar o quitar un código corta el acceso al instante.

La **contraseña de administrador** (`ADMIN_PASSWORD`) se pide solo para borrar cobros o lecturas con pagos registrados.

## El mes a mes

La pantalla **Resumen → «Qué hacer este mes»** muestra lo que falta y un botón para cada paso:

1. **Día 12 — lecturas.** *Tomar lecturas* abre los medidores uno tras otro (luz y agua de cada depto y el medidor general). La foto se lee sola; revisa el número. Si el consumo sale muy distinto a lo normal, la app pregunta antes de guardar.
2. **Recibos.** *Luz → Subir recibo PDF* y *Agua → Subir recibo*. Los datos se leen del PDF y el archivo se guarda en Drive con el nombre del mes.
3. **Enviar los cobros.** *Cobros → 📲 Enviar cobros por WhatsApp*: un mensaje listo para cada depto.
4. **Registrar pagos.** *✓ Pagó* registra el pago completo con la fecha de hoy (se puede deshacer). Para un pago parcial o de más, *Detalle*. Luego *📲 Comprobante* envía la constancia.
5. **Recordar a quienes deben.** *Cobros → Pendientes → 📲 Recordar* arma un mensaje con todos los meses que debe ese depto.

## Cómo se calcula

- **Luz:** el recibo del mes (sin intereses por atraso) se reparte según los kWh de cada medidor frente a la suma de todos los medidores internos.
- **Agua:** cada depto con medidor paga lo que marca su medidor más su parte proporcional del agua que no marca ningún medidor. Los deptos sin medidor pagan una base de m³ por mes (se cambia en *Cargos del mes*) más el exceso cuando el agua sin medir se sale de lo normal.
- **Administración y mantenimiento:** montos fijos por depto, configurables por mes.
- **Moras, intereses, corte y reapertura:** se reparten en partes iguales entre los deptos que **aún no registran su pago completo** del mes anterior. Cuando uno paga, sale del reparto. Si ya todos pagaron, la cargan quienes pagaron fuera de fecha; si nadie, no se cobra.
- **Saldo a favor:** si alguien paga de más, la diferencia se descuenta sola del mes siguiente.
- **Meses cerrados:** los meses anteriores a abril 2026 se muestran tal como se pagaron, sin recalcular.

## Funciones que se ejecutan desde el editor de Apps Script

Hoja → *Extensiones → Apps Script* → elegir la función junto a ▶️ → *Ejecutar*.

| Función | Para qué | Cuándo |
|---|---|---|
| `activarRespaldoSemanal` | Copia de la Hoja cada lunes en *RECIBOS_JARDIN/Respaldos* (guarda las últimas 8) | Una vez |
| `crearRecordatorioMedidores` | Evento mensual en Google Calendar para tomar las lecturas (día 12) | Una vez |
| `cerrarMesesHistoricos` | Deja enero–marzo 2026 con lo que pagó cada uno | Una vez |
| `setup` | Crea las pestañas de la Hoja si faltan | Solo al instalar |

## Publicar cambios en el código

Desde la rama `main`, con todo en commit:

```bash
bash tools/publicar.sh "Descripción del cambio"
```

Revisa el HTML, sube el código a Apps Script, actualiza la implementación (la URL no cambia) y hace `git push` (GitHub Pages tarda 1–2 minutos).

> El revisor (`tools/revisar-html.js`) es obligatorio: Apps Script corta los `//` dentro de los textos del JavaScript. En el código, las URL van escritas con `\/\/`.

## Preguntas frecuentes

**¿Se ve lo que cambia otra persona?** Sí: la app revisa cambios cada 10 segundos mientras está abierta. Si dos personas editan el mismo cobro o lectura a la vez, no se pisa el cambio: la segunda ve un aviso y la versión nueva.

**¿Tiene costo?** No. Sheets, Drive y Apps Script son gratis dentro de los límites de una cuenta personal.

**¿Y si se borra algo por error?** Hay copias semanales en *RECIBOS_JARDIN/Respaldos* (después de ejecutar `activarRespaldoSemanal`), y la papelera de Drive guarda los archivos 30 días.
