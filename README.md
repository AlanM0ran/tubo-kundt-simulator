# Tubo de Kundt — Simulador 1D (versión web estática)

Reimplementación del simulador de tubo de Kundt (antes en Streamlit) como sitio
estático HTML + CSS + JS puro, pensado para desplegarse directamente en Vercel,
sin backend ni build step.

## Por qué sin Python en el servidor

Todo el modelo físico original (`reflexion_coeff`, `particle_disp_params`,
`pressure_amplitude_db`, `velocity_amplitude`) son expresiones cerradas —
nada de integración numérica pesada — así que se portaron 1:1 a JavaScript
(`script.js`) y corren en el navegador. Esto significa:

- Los sliders responden al instante (sin round-trip a un servidor).
- No hay cold starts de funciones serverless.
- El despliegue en Vercel es "Other / static", sin build command.

El port se verificó numéricamente contra las funciones originales de Python en
420 combinaciones de f/R/M/x (todo el rango de los sliders): la diferencia
máxima fue de ~1e-14, es decir, error de punto flotante, no de fórmula.

## Cómo desplegar en Vercel

1. Creá un repo nuevo y subí estos 3 archivos a la raíz (`index.html`,
   `style.css`, `script.js`):
   ```
   git init
   git add index.html style.css script.js
   git commit -m "Tubo de Kundt — versión web"
   git branch -M main
   git remote add origin <tu-repo-en-github>
   git push -u origin main
   ```
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importá el repo.
3. Framework Preset: **Other**. Dejá Build Command y Output Directory vacíos
   (o Output Directory = `.`). Vercel sirve los archivos tal cual.
4. **Deploy**. Listo, sin variables de entorno ni configuración adicional.

No hace falta `vercel.json`: al no detectar ningún framework, Vercel sirve
`index.html` y los estáticos directamente.

`requirements.txt` y `devcontainer.json` quedan obsoletos para este
despliegue (eran para correr Streamlit en un Codespace); podés conservarlos
si en algún momento querés seguir usando la versión Python/Streamlit en
paralelo, pero no los necesitás para Vercel.

## Qué cambió respecto a la versión Streamlit

- **Color de partículas por presión** (lo que pediste), con dos modos:
  - **Divergente**: rojo = compresión, azul = rarefacción, sobre la presión
    instantánea `Re[p(x)·e^{i2πt}]` — el color respira en fase con la
    animación de las partículas, no es una foto fija.
  - **Mapa de calor**: colormap continuo (tipo *turbo*) sobre la envolvente
    `|p(x)|` — patrón fijo de nodos/antinodos, útil para ubicarlos de un
    vistazo.
  Ambos se aplican también como gradiente de fondo dentro del tubo, no solo
  a las partículas — así se ve el campo completo, no solo 46 puntos. Cada
  partícula lleva halo de sombra + brillo especular (aspecto "cuenta de
  vidrio"), para que se distinga del fondo incluso cuando su color coincide
  con el del punto de fondo que tiene detrás.
- Gráficos de presión (dB) y velocidad redibujados a mano en canvas (antes
  Plotly vía iframe), con la misma identidad visual que el resto de la app,
  sin la librería de ~1 MB de Plotly.
- Barra de color con escala, lectura de |Γ| y λ en vivo, y un panel de
  controles con estética de instrumento de laboratorio (paneles, LCD de
  lectura, sliders con marcas de calibración).
- Botón único "Reproducir/Pausar" (antes dos botones separados).

## Estructura

```
index.html   estructura + controles
style.css    identidad visual (tema oscuro, tipografía IBM Plex)
script.js    física (verificada), colormaps, render en canvas, animación
```

Todo el texto de la interfaz está en español, igual que el original.
