# Seguridad

## ¿Cómo sé que el instalador no es un virus?

1. **Se compila en GitHub, no en una PC.** Cada instalador de la pestaña
   *Releases* lo arma el workflow [`release.yml`](.github/workflows/release.yml)
   en los servidores de GitHub, a partir del código público de ese tag. El
   registro de la compilación queda visible en la pestaña *Actions*.
2. **Origen verificable.** GitHub firma una *attestation* que vincula el `.exe`
   con el commit y el workflow que lo generaron. Con la
   [CLI de GitHub](https://cli.github.com/) se comprueba así:

   ```powershell
   gh attestation verify "BROSS.DJ.Setup.X.Y.Z.exe" --repo bross14/bross-dj
   ```

3. **Hash SHA-256.** Cada release trae `SHA256SUMS.txt`. Para comparar:

   ```powershell
   Get-FileHash "BROSS.DJ.Setup.X.Y.Z.exe" -Algorithm SHA256
   ```

4. **Compilarlo uno mismo.** Ver "Producción e instalador" en el
   [README](README.md).

El instalador todavía **no tiene firma de código**, así que Windows SmartScreen
puede mostrar "Windows protegió su PC". Eso pasa con cualquier programa nuevo
sin firma y no significa que tenga un virus: tocá *Más información → Ejecutar de
todas formas*, o verificalo primero con los pasos de arriba.

## Qué hace el programa con tu PC y tus datos

- Solo lee las carpetas de música que agregás vos o los archivos que importás.
- Guarda la biblioteca y los ajustes en `%APPDATA%/bross-dj`, y las grabaciones
  en `Música/BROSS DJ`.
- **No envía datos ni estadísticas.** Solo se conecta a internet cuando usás:
  YouTube (reproductor oficial), Spotify (solo lectura de tus playlists, con tu
  login), o LIVE/RTMP hacia el servidor que configures.
- El servidor local (`localhost:41731`) solo escucha en tu PC. La opción de
  transmitir a la red local abre un puerto en tu red solo mientras está activa.

## Reportar un problema de seguridad

Si encontrás una vulnerabilidad, no la publiques en un issue: usá
*Security → Report a vulnerability* en el repositorio (aviso privado).
