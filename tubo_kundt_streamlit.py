import streamlit as st
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from scipy.signal import find_peaks

# ------------------------------------------------------------
# Parámetros físicos (iguales a tu código)
# ------------------------------------------------------------
c = 343
rho = 1.21
Z0 = rho * c
L = 1.0

def reflexion_coeff(R, M, f):
    ZL = R + 1j * 2 * np.pi * f * M
    return (ZL - Z0) / (ZL + Z0)

def particle_velocity_amplitude(x, f, R, M):
    k = 2 * np.pi * f / c
    Gamma = reflexion_coeff(R, M, f)
    u_complex = -1j * (np.exp(-1j * k * x) - Gamma * np.exp(1j * k * x))
    return np.abs(u_complex), np.angle(u_complex)

def pressure_amplitude(x, f, R, M):
    k = 2 * np.pi * f / c
    Gamma = reflexion_coeff(R, M, f)
    p_complex = np.exp(-1j * k * x) + Gamma * np.exp(1j * k * x)
    return 20 * np.log10(np.abs(p_complex) + 1e-12)

# ------------------------------------------------------------
# Interfaz Streamlit
# ------------------------------------------------------------
st.set_page_config(layout="wide")
st.title("🔊 Tubo de Kundt - Simulador Interactivo")
st.markdown("Visualiza la onda estacionaria en un tubo con extremo adaptable (resistencia R y masa M).")

# Columnas para controles (mejor para móvil)
col1, col2 = st.columns([1, 2])

with col1:
    st.subheader("Parámetros")
    f = st.slider("Frecuencia (Hz)", 50, 800, 200, step=1)
    R = st.slider("Resistencia R (rayls)", 10, 5000, 2000, step=10)
    M = st.slider("Masa M (kg/m⁴)", 0.001, 0.5, 0.001, step=0.001, format="%.4f")
    t = st.slider("Instante de tiempo (t / T)", 0.0, 1.0, 0.0, step=0.01,
                  help="Posición en el ciclo de la onda (0 = inicio, 1 = un periodo completo)")
    mostrar_nodos = st.checkbox("Mostrar nodos de presión", value=False)

# Convertir t a fase: ángulo = 2π * t
phase = 2 * np.pi * t

# ------------------------------------------------------------
# Generar la figura de matplotlib
# ------------------------------------------------------------
fig, (ax_main, ax_pressure) = plt.subplots(2, 1, figsize=(10, 8),
                                           gridspec_kw={'height_ratios': [2, 1]})

# --- Tubo: estructura y partículas ---
ax_main.set_xlim(0, L)
ax_main.set_ylim(-0.3, 0.3)
ax_main.set_xlabel("Posición en el tubo (m)")
ax_main.set_ylabel("Vertical (m)")
ax_main.set_title(f"Tubo de Kundt - f = {f} Hz, R = {R}, M = {M:.4f}")
ax_main.grid(True, alpha=0.2)
ax_main.axhline(y=0.2, color='black', linewidth=3)
ax_main.axhline(y=-0.2, color='black', linewidth=3)
ax_main.fill_between([0, L], 0.2, -0.2, alpha=0.1, color='lightblue')
ax_main.add_patch(Rectangle((-0.05, -0.22), 0.05, 0.44, color='gray', alpha=0.5))
ax_main.add_patch(Rectangle((L, -0.22), 0.05, 0.44, color='gray', alpha=0.5))

# Posiciones de las partículas (rejilla)
x_pos = np.linspace(0.05, L-0.05, 40)
y_pos = np.linspace(-0.15, 0.15, 8)
Xg, Yg = np.meshgrid(x_pos, y_pos)

# Calcular desplazamiento horizontal para cada columna en el instante t
desplazamientos = []
for x0 in x_pos:
    amp, ang = particle_velocity_amplitude(x0, f, R, M)
    # La velocidad máxima teórica es 2 (en antinodo)
    norm_amp = amp / 2.0
    # Desplazamiento = amplitud_normalizada * sen(ωt + fase_velocidad)
    # pero la velocidad está desfasada 90° respecto al desplazamiento.
    # Para mostrar el movimiento, usamos desplazamiento ∝ integral de velocidad = seno con -90°
    # Simplificación: desplazamiento = A * cos(ωt + fase_velocidad)
    # Usamos directamente amplitud de desplazamiento (1/ω) * velocidad, pero para visual escalamos.
    disp_magnitude = 0.08 * norm_amp  # escala visual
    # El signo del movimiento: la velocidad oscila, el desplazamiento sigue el seno con la fase adecuada.
    # Como solo mostramos un instante, calculamos el desplazamiento actual:
    # desplazamiento actual = disp_magnitude * sin(2πf t + fase_velocidad + π/2) (porque desplazamiento está 90° retrasado)
    # Para simplificar, hacemos: desplazamiento = disp_magnitude * cos(phase + ang)   (ang es fase de velocidad)
    displacement = disp_magnitude * np.cos(phase + ang)
    desplazamientos.append(displacement)

# Aplicar desplazamiento a todas las partículas de cada columna
new_x = []
for i, x0 in enumerate(x_pos):
    for y0 in y_pos:
        new_x.append(x0 + desplazamientos[i])
        new_y = y0

# Colorear según la intensidad del movimiento
colors = []
for d in desplazamientos:
    intensity = min(1.0, abs(d) / 0.08)
    for _ in y_pos:
        if intensity < 0.3:
            colors.append('darkblue')
        elif intensity < 0.6:
            colors.append('blue')
        else:
            colors.append('red')

ax_main.scatter(new_x, new_y, c=colors, s=20, alpha=0.7, edgecolors='black', linewidth=0.5)

# --- Perfil de presión ---
x_pres = np.linspace(0, L, 500)
presion_db = [pressure_amplitude(xp, f, R, M) for xp in x_pres]
ax_pressure.plot(x_pres, presion_db, 'r-', linewidth=2, label='Presión')
ax_pressure.set_xlim(0, L)
ax_pressure.set_ylim(-40, 10)
ax_pressure.set_xlabel("Posición (m)")
ax_pressure.set_ylabel("Presión (dB)")
ax_pressure.set_title("Perfil de presión a lo largo del tubo")
ax_pressure.grid(True, alpha=0.3)
ax_pressure.axhline(y=0, color='black', linestyle='--', alpha=0.5)
ax_pressure.legend()

if mostrar_nodos:
    # Encontrar nodos (mínimos locales de presión) usando scipy
    minima = find_peaks(-np.array(presion_db), distance=20)[0]
    for idx in minima:
        x_node = x_pres[idx]
        ax_pressure.axvline(x_node, color='purple', linestyle='--', alpha=0.7, linewidth=1)
        ax_main.axvline(x_node, color='purple', linestyle='--', alpha=0.7, linewidth=1)

# Mostrar la figura en Streamlit
st.pyplot(fig)

# Información adicional
st.caption(f"Coeficiente de reflexión |Γ| = {np.abs(reflexion_coeff(R, M, f)):.3f}")
st.markdown("---")
st.markdown("💡 **Nota**: Mueva los deslizadores para cambiar la frecuencia o la impedancia del extremo. "
            "Use el deslizador **Instante de tiempo** para ver cómo se mueven las partículas dentro del ciclo de la onda.")