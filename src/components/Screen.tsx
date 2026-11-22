/**
 * Ventana de pantalla (video / karaoke): la abre la app con window.open y le
 * pasa la salida del mezclador a este <video>. Doble clic: pantalla completa.
 */
export function Screen() {
  return (
    <div
      className="screen-root"
      onDoubleClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }}
      title="Doble clic: pantalla completa"
    >
      <video id="screen-video" autoPlay muted playsInline />
    </div>
  );
}
