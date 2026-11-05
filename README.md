# GoMoonPOS

Punto de venta de escritorio (Electron + React + TypeScript + SQLite vía sql.js).

## Comandos
- `npm install` — dependencias
- `npm run dev` — desarrollo con recarga
- `npm start` — compila y ejecuta
- `npm test` — pruebas de la lógica de negocio
- `npm run dist` — genera el instalador de Windows (NSIS) en `dist/`
- `npm run release` — publica la versión en GitHub Releases (requiere `GH_TOKEN`)

Usuario inicial: `admin` / `admin123` (cámbialo al primer ingreso). Los datos se guardan en `%APPDATA%\GoMoonPOS\gomoonpos.sqlite`.

## Publicar actualizaciones automáticas

Las versiones instaladas consultan las [GitHub Releases de LunaHdz96/GoMoonPOS](https://github.com/LunaHdz96/GoMoonPOS/releases) al abrirse. Si hay una versión más reciente, la aplicación ofrece descargarla y luego instalarla al reiniciar.

1. Crea el repositorio público `LunaHdz96/GoMoonPOS` en GitHub y sube este proyecto antes de publicar la primera versión.
2. Cambia `version` en `package.json` (por ejemplo, `0.1.1`).
3. Genera un [personal access token de GitHub](https://github.com/settings/tokens/new) con permiso **Contents: Read and write** para ese repositorio.
4. En PowerShell, sin guardar el token en el código:

   ```powershell
   $env:GH_TOKEN = 'tu_token'
   npm run release
   ```

`npm run release` crea la GitHub Release, publica el instalador y el archivo `latest.yml` requerido por el actualizador. Para probar actualizaciones, instala primero una versión publicada, incrementa la versión, publícala y abre la instalación anterior.

## Módulos
- **Ventas**: cobro, descuentos (cajero hasta 10%, más requiere supervisor), pagos mixtos (efectivo/tarjeta/transferencia/fiado), cancelación.
- **Inventario**: existencias en tiempo real, entradas, mermas, ajustes, alertas de stock bajo.
- **Clientes / Fiados**: límite y días de crédito, abonos, estado de cuenta (imprimir / WhatsApp).
- **Préstamos**: salida sin venta ligada al cliente, no afecta el corte de caja, alertas de devolución vencida.
- **Reportes**: corte de caja, ventas por producto, horas pico, desempeño por empleado, cartera vencida.
- **Usuarios y permisos**: cajero, gerente, administrador. Fiar y prestar requieren supervisor (el cajero puede pedir autorización con credenciales de un gerente/admin).
