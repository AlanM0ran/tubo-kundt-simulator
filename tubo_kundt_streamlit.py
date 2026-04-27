import streamlit as st
import numpy as np
from scipy.signal import find_peaks
import json
import urllib.parse   # <-- nueva importación

# ------------------------------------------------------------
# Parámetros físicos (resto igual)
# ------------------------------------------------------------
c = 343
rho = 1.21
Z0 = rho * c
L = 1.0

def reflexion_coeff(R, M, f):
    ZL = R + 1j * 2 * np.pi * f * M
    return (ZL - Z0) / (ZL + Z0)

def particle_disp_params(x, f, R, M):
    k = 2 * np.pi * f / c
    Gamma = reflexion_coeff(R, M, f)
    u_complex = -1j * (np.exp(-1j * k * x) - Gamma * np.exp(1j * k * x))
    amp = np.abs(u_complex)
    phase = np.angle(u_complex)
    max_amp = 2.0
    norm_amp = amp / max_amp
    phase_shifted = phase - np.pi/2
    return norm_amp, phase_shifted

def pressure_amplitude_db(x, f, R, M):
    k = 2 * np.pi * f / c
    Gamma = reflexion_coeff(R, M, f)
    p_complex = np.exp(-1j * k * x) + Gamma * np.exp(1j * k * x)
    return 20 * np.log10(np.abs(p_complex) + 1e-12)

def velocity_amplitude(x, f, R, M):
    k = 2 * np.pi * f / c
    Gamma = reflexion_coeff(R, M, f)
    v_complex = -1j * (np.exp(-1j * k * x) - Gamma * np.exp(1j * k * x))
    return np.abs(v_complex)

# ------------------------------------------------------------
# Interfaz Streamlit
# ------------------------------------------------------------
st.set_page_config(layout="wide")
st.title("🔊 Tubo de Kundt - Presión y Velocidad")

col1, col2 = st.columns([1, 2])

with col1:
    f = st.slider("Frecuencia (Hz)", 50, 800, 200, step=1)
    R = st.slider("Resistencia R (rayls)", 10, 5000, 2000, step=10)
    M = st.slider("Masa M (kg/m⁴)", 0.001, 0.5, 0.001, format="%.4f")
    mostrar_nodos = st.checkbox("Mostrar nodos de presión")

# ---- Datos para partículas ----
x_cols = np.linspace(0.05, L-0.05, 40)
y_rows = np.linspace(-0.15, 0.15, 8)

amps = []
phases = []
for x0 in x_cols:
    amp, ph = particle_disp_params(x0, f, R, M)
    amps.append(amp)
    phases.append(ph)

particles_rest_x = []
particles_rest_y = []
for x0 in x_cols:
    for y0 in y_rows:
        particles_rest_x.append(x0)
        particles_rest_y.append(y0)

# ---- Datos de presión y velocidad ----
x_pres = np.linspace(0, L, 300)
presion_db = [pressure_amplitude_db(xp, f, R, M) for xp in x_pres]
velocidad_amp = [velocity_amplitude(xp, f, R, M) for xp in x_pres]

# ---- Nodos de presión ----
nodos_x = []
if mostrar_nodos:
    minima = find_peaks(-np.array(presion_db), distance=20)[0]
    nodos_x = [x_pres[i] for i in minima]

# ---- Datos para pasar al frontend ----
data = {
    "particles_rest_x": particles_rest_x,
    "particles_rest_y": particles_rest_y,
    "amps": amps,
    "phases": phases,
    "x_cols": x_cols.tolist(),
    "y_rows": y_rows.tolist(),
    "n_part_col": len(y_rows),
    "L": L,
    "pressure_x": x_pres.tolist(),
    "pressure_y": presion_db,
    "velocity_x": x_pres.tolist(),
    "velocity_y": velocidad_amp,
    "nodos_x": nodos_x,
    "amp_factor": 0.08,
    "freq": f,
    "R": R,
    "M": M
}

# ------------------------------------------------------------
# Componente HTML con 3 subplots (escapado correctamente)
# ------------------------------------------------------------
html_code = f"""
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdn.plot.ly/plotly-3.0.1.min.js" charset="utf-8"></script>
    <style>
        body {{ font-family: sans-serif; margin: 0; padding: 10px; }}
        #plot {{ width: 100%; height: 800px; }}
        .controls {{
            text-align: center;
            margin-top: 10px;
        }}
        button {{
            font-size: 16px;
            padding: 8px 20px;
            margin: 5px;
            cursor: pointer;
            border: none;
            border-radius: 5px;
            background-color: #2c3e50;
            color: white;
        }}
        button:hover {{ background-color: #1a252f; }}
    </style>
</head>
<body>
    <div id="plot"></div>
    <div class="controls">
        <button id="loopBtn">🔁 Reproducir en bucle</button>
        <button id="stopBtn">⏹ Detener</button>
    </div>
    <script>
        const data = {json.dumps(data)};
        const nPart = data.particles_rest_x.length;
        const nCols = data.x_cols.length;
        const nRows = data.y_rows.length;
        const ampFactor = data.amp_factor;
        
        let animating = false;
        let animTime = 0.0;
        let animationId = null;
        
        const colors = data.amps.map(amp => {{
            if (amp < 0.3) return 'darkblue';
            if (amp < 0.6) return 'blue';
            return 'red';
        }});
        const particleColors = [];
        for (let col = 0; col < nCols; col++) {{
            for (let row = 0; row < nRows; row++) {{
                particleColors.push(colors[col]);
            }}
        }}
        
        function computePositions(t) {{
            const newX = new Array(nPart);
            for (let col = 0; col < nCols; col++) {{
                const amp = data.amps[col];
                const phase = data.phases[col];
                const dispMag = ampFactor * amp;
                const disp = dispMag * Math.cos(2 * Math.PI * t + phase);
                const x0 = data.x_cols[col];
                for (let row = 0; row < nRows; row++) {{
                    const idx = col * nRows + row;
                    newX[idx] = x0 + disp;
                }}
            }}
            return newX;
        }}
        
        const traceParticles = {{
            x: computePositions(0),
            y: data.particles_rest_y,
            mode: 'markers',
            type: 'scatter',
            marker: {{ color: particleColors, size: 8, line: {{ color: 'black', width: 0.5 }} }},
            name: 'Partículas'
        }};
        
        const tracePressure = {{
            x: data.pressure_x,
            y: data.pressure_y,
            mode: 'lines',
            type: 'scatter',
            line: {{ color: 'red', width: 2 }},
            name: 'Presión (dB)'
        }};
        
        const traceVelocity = {{
            x: data.velocity_x,
            y: data.velocity_y,
            mode: 'lines',
            type: 'scatter',
            line: {{ color: 'green', width: 2 }},
            name: 'Velocidad (normalizada)'
        }};
        
        const layout = {{
            title: `Tubo de Kundt - f = {f} Hz, R = {R}, M = {M:.4f}`,
            grid: {{ rows: 3, columns: 1, pattern: 'independent', roworder: 'top to bottom' }},
            xaxis: {{ title: 'Posición (m)', domain: [0, 0.85], range: [-0.1, data.L+0.1] }},
            yaxis: {{ title: 'Vertical (m)', domain: [0.66, 1], range: [-0.3, 0.3] }},
            xaxis2: {{ title: 'Posición (m)', domain: [0, 0.85], matches: 'x', range: [-0.1, data.L+0.1] }},
            yaxis2: {{ title: 'Presión (dB)', domain: [0.33, 0.66], range: [-40, 10] }},
            xaxis3: {{ title: 'Posición (m)', domain: [0, 0.85], matches: 'x', range: [-0.1, data.L+0.1] }},
            yaxis3: {{ title: 'Velocidad (normalizada)', domain: [0, 0.33], range: [0, 2.2] }},
            legend: {{ x: 0.87, y: 1 }},
            height: 800,
            hovermode: 'closest',
            shapes: []
        }};
        
        const tubeShapes = [
            {{ type: 'line', x0: 0, x1: data.L, y0: 0.2, y1: 0.2, line: {{ color: 'black', width: 3 }}, xref: 'x', yref: 'y' }},
            {{ type: 'line', x0: 0, x1: data.L, y0: -0.2, y1: -0.2, line: {{ color: 'black', width: 3 }}, xref: 'x', yref: 'y' }},
            {{ type: 'rect', x0: 0, x1: data.L, y0: -0.2, y1: 0.2, fillcolor: 'lightblue', opacity: 0.2, line: {{ width: 0 }}, xref: 'x', yref: 'y' }},
            {{ type: 'rect', x0: -0.05, x1: 0, y0: -0.22, y1: 0.22, fillcolor: 'gray', opacity: 0.5, line: {{ width: 0 }}, xref: 'x', yref: 'y' }},
            {{ type: 'rect', x0: data.L, x1: data.L+0.05, y0: -0.22, y1: 0.22, fillcolor: 'gray', opacity: 0.5, line: {{ width: 0 }}, xref: 'x', yref: 'y' }}
        ];
        layout.shapes.push(...tubeShapes);
        
        for (let xn of data.nodos_x) {{
            layout.shapes.push({{ type: 'line', x0: xn, x1: xn, y0: -0.3, y1: 0.3, line: {{ color: 'purple', dash: 'dash', width: 1 }}, xref: 'x', yref: 'y' }});
            layout.shapes.push({{ type: 'line', x0: xn, x1: xn, y0: -40, y1: 10, line: {{ color: 'purple', dash: 'dash', width: 1 }}, xref: 'x2', yref: 'y2' }});
            layout.shapes.push({{ type: 'line', x0: xn, x1: xn, y0: 0, y1: 2.2, line: {{ color: 'purple', dash: 'dash', width: 1 }}, xref: 'x3', yref: 'y3' }});
        }}
        
        Plotly.newPlot('plot', [
            {{ ...traceParticles, xaxis: 'x', yaxis: 'y' }},
            {{ ...tracePressure, xaxis: 'x2', yaxis: 'y2' }},
            {{ ...traceVelocity, xaxis: 'x3', yaxis: 'y3' }}
        ], layout);
        
        function animateFrame() {{
            if (!animating) return;
            animTime += 0.02;
            if (animTime >= 1.0) {{
                animTime = 0.0;
            }}
            const newX = computePositions(animTime);
            Plotly.restyle('plot', {{ x: [newX] }}, [0]);
            animationId = requestAnimationFrame(animateFrame);
        }}
        
        function startLoop() {{
            if (animationId) cancelAnimationFrame(animationId);
            animating = true;
            animTime = 0.0;
            animateFrame();
        }}
        
        function stopAnimation() {{
            animating = false;
            if (animationId) {{
                cancelAnimationFrame(animationId);
                animationId = null;
            }}
            const resetX = computePositions(0);
            Plotly.restyle('plot', {{ x: [resetX] }}, [0]);
        }}
        
        document.getElementById('loopBtn').addEventListener('click', startLoop);
        document.getElementById('stopBtn').addEventListener('click', stopAnimation);
    </script>
</body>
</html>
"""

# --- Reemplazo de st.components.v1.html por st.iframe ---
iframe_src = f"data:text/html;charset=utf-8,{urllib.parse.quote(html_code)}"
st.iframe(iframe_src, height=850)

st.caption(f"Coeficiente de reflexión |Γ| = {np.abs(reflexion_coeff(R, M, f)):.3f}")
st.markdown("🎬 **Uso**: Mueva sliders → cambian los perfiles. Pulse **Reproducir en bucle** para animar las partículas. **Mostrar nodos** dibuja líneas verticales.")