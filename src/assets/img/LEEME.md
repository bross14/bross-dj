# Imágenes reales del proyecto

Dejá acá los archivos con estos nombres. La app los usa **tal cual**, sin
redibujarlos: se insertan con `<img>` / `background-image`.

## Conectado ahora

| Archivo | Dónde se usa | Tamaño recomendado |
| --- | --- | --- |
| `vinyl-a.png` / `.jpg` / `.webp` | Disco del Deck A | 784×784 px (cuadrado), disco centrado |
| `vinyl-b.png` / `.jpg` / `.webp` | Disco del Deck B | 784×784 px (cuadrado), disco centrado |
| `vinyl.png` / `.jpg` / `.webp` | Mismo disco para los dos decks | 784×784 px (cuadrado) |
| `vinyl-light-a.webp` | Luz del aro del Deck A (azul marino), la única capa que gira | Mismo tamaño que el disco, WebP transparente |
| `vinyl-light-b.webp` | Luz del aro del Deck B (magenta flúor), la única capa que gira | Mismo tamaño que el disco, WebP transparente |
| `knob.png` | Potenciómetros del mixer (GAIN, HI, MID, LOW, FLTR, MASTER) | 120×120 px (se muestra a 30×30), PNG transparente |
| `pitch-rail-a.png` | Riel del pitch del Deck A (marcas a la derecha) | 136×720 px (se muestra a 34×180), PNG transparente |
| `pitch-rail-b.png` | Riel del pitch del Deck B (marcas a la izquierda) | 136×720 px (se muestra a 34×180), PNG transparente |
| `fader-rail.png` | Riel del fader de volumen de cada deck | 136×720 px (se muestra a 34×180), PNG transparente |
| `fader-thumb.png` | Tapa del fader de volumen y del pitch | 136×60 px (se muestra a 34×15), PNG transparente |
| `xfader-thumb.png` | Perilla del crossfader (vertical, girada 90°) | 60×136 px (se muestra a 15×34), PNG transparente |

Si el archivo no existe, se muestra el vinilo / pitch CSS actual (no rompe nada).
Cuando existen `vinyl-light-a.webp` y `vinyl-light-b.webp`, el disco queda fijo
(con la palabra BROSSDJ) y solo gira la luz del aro con la reproducción: azul
marino en el Deck A y magenta flúor en el Deck B. Si no están, el disco rota
entero como antes y el fader del pitch se mueve por encima del carril.

**Origen:** todas las imágenes de esta carpeta (disco, luz del aro, perilla,
rieles y tapas de los faders) se generan con `python tools/generate-art.py`
(Pillow) a partir de formas geométricas. No hay recortes ni fotos de otros
programas o equipos. Para cambiarlas, editá el script y volvé a correrlo, o
reemplazá los archivos por diseños propios con el mismo nombre y tamaño.

**Pitch:** `pitch-rail-a.png` (marcas a la derecha de la ranura, Deck A) y
`pitch-rail-b.png` (a la izquierda, Deck B), 13 marcas: la del 0 al centro y 6
por lado; las pares son largas y las impares cortas.

**Mixer:** `knob.png` (el indicador blanco se dibuja en CSS para que gire solo
la aguja), `fader-rail.png` con 12 marcas, `fader-thumb.png` (34×15 px en
pantalla) y `xfader-thumb.png`, la misma tapa girada 90°. Si falta alguno, la
app vuelve sola a las perillas y faders dibujados por CSS.

## Convención para el resto (todavía no se usan)

| Archivo | Dónde iría | Tamaño |
| --- | --- | --- |
| `logo.png` / `logo.svg` | Barra superior | alto ~24 px |
| `pad.png` | Pads / hot cues | 128×64 px |
| `bg.png` | Fondo general | 1920×1080 px |
| `deck-a-bg.png`, `deck-b-bg.png` | Fondo de cada deck | 1034×704 px |
| `mixer-bg.png` | Fondo del mixer | 488×704 px |
| `browser-bg.png` | Fondo del navegador | 2560×428 px |

## Formatos

- **PNG o WebP** con transparencia para discos, perillas y rieles.
- **SVG** para logos e iconos (se ve nítido a cualquier escala).
- **JPG** solo para fotos/fondos sin transparencia.
- Mantené cada archivo por debajo de ~500 KB para que la app abra rápido.

## Cómo reemplazarlas

Copiá tus archivos a esta carpeta (`src/assets/img/`) con el mismo nombre.
No hace falta tocar código: Vite los detecta y los usa.
