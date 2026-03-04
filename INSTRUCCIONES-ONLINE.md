# 🎮 GUERRA MATEMÁTICA — Subir a Internet

Con estos archivos ya tienes todo listo. Solo sigue los pasos.

---

## PASO 1 — Crea cuenta en GitHub (gratis)
1. Ve a: https://github.com
2. Click en **Sign up**
3. Pon tu correo, contraseña y nombre de usuario
4. Verifica tu correo

---

## PASO 2 — Sube los archivos a GitHub
1. Entra a tu cuenta en https://github.com
2. Click en el botón verde **New** (arriba a la izquierda)
3. En **Repository name** escribe: `guerra-matematica`
4. Deja todo lo demás igual → click **Create repository**
5. En la página que aparece, busca el texto que dice **"uploading an existing file"** → click ahí
6. **Arrastra TODOS estos archivos** (los que descargaste):
   - `server.js`
   - `package.json`
   - `.gitignore`
   - La carpeta `public` → arrastra los 3 archivos que están adentro: `index.html`, `blue.html`, `red.html`
7. Click **Commit changes** (botón verde abajo)

---

## PASO 3 — Crea cuenta en Render (gratis)
1. Ve a: https://render.com
2. Click **Get Started for Free**
3. Regístrate con tu cuenta de GitHub (más fácil)
4. Autoriza los permisos que pide

---

## PASO 4 — Despliega el juego en Render
1. En Render, click en **New +** → **Web Service**
2. En la lista de repositorios, selecciona **guerra-matematica**
3. Configura así:
   - **Name:** guerra-matematica (o el nombre que quieras)
   - **Region:** Oregon (USA) — deja el que viene por defecto
   - **Branch:** main
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free ✅
4. Click **Create Web Service**
5. Espera 2-3 minutos mientras se despliega (verás logs en pantalla)

---

## PASO 5 — ¡Listo! Copia tu link

Cuando termine, Render te muestra tu URL arriba. Será algo como:
```
https://guerra-matematica.onrender.com
```

### Tus links para compartir:
| Quién | Link |
|-------|------|
| 📺 Pantalla principal | `https://guerra-matematica.onrender.com` |
| 🔵 Equipo Azul | `https://guerra-matematica.onrender.com/blue` |
| 🔴 Equipo Rojo | `https://guerra-matematica.onrender.com/red` |

**Estos links funcionan desde cualquier celular, tablet o computadora, en cualquier red.**

---

## ⚠️ Aviso importante — Plan Gratuito

El plan gratis de Render **"duerme"** el servidor si nadie lo usa por 15 minutos.
Cuando alguien entre después de ese tiempo, la primera carga tarda **~30 segundos**.
Después de eso, todo funciona normal y rápido.

**Solución:** Abre el link de la pantalla principal unos minutos antes de jugar.

---

## ❓ Problemas comunes

**"No conecta" al entrar:**
→ Espera 30 segundos y recarga la página. El servidor estaba dormido.

**Los jugadores no aparecen:**
→ Asegúrate que todos usen los links correctos (/blue y /red)

**Quiero que nunca duerma:**
→ En Render, cambia el plan a **Starter ($7/mes)**
