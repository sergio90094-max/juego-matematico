/**
 * TUG OF WAR — Servidor Multijugador
 * WebSockets en tiempo real
 * Puerto: 3000
 */

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

/* ══════════════════════════════════════
   ESTADO DEL JUEGO (centralizado)
══════════════════════════════════════ */
let gameDifficulty = 'easy'; // 'easy' | 'medium' | 'hard'  ← debe ir ANTES de genQ

function freshState() {
  const q = genQ();
  return {
    ans:   q.answer,
    qtext: q.text,
    pos:   0,          // -50..+50  (neg=azul gana, pos=rojo gana)
    rnd:   1,
    sb:    0,  sr:  0, // puntos totales
    cb:    0,  cr:  0, // correctas por equipo
    over:  false,
    timer: 38,
    ib:    '',  ir: '' // buffers de input
  };
}

let G = freshState();
let timerInterval = null;
let gameStarted = false;
let gamePaused = false;

/* ══════════════════════════════════════
   CLIENTES CONECTADOS
   tipo: 'screen' | 'blue' | 'red'
══════════════════════════════════════ */
const clients = new Map(); // ws -> { type }

/* ══════════════════════════════════════
   GENERADOR DE PREGUNTAS
══════════════════════════════════════ */
function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function genQ() {
  const d = gameDifficulty;
  let a, b, ans, text;

  if (d === 'easy') {
    // ── FÁCIL: tablas 1-15, multiplicación y división directa ──
    const type = rnd(0, 3);
    switch(type) {
      case 0: // Multiplicación tablas 1-15
        a = rnd(1,15); b = rnd(1,15);
        ans = a*b; text = a + ' × ' + b + ' = ?';
        break;
      case 1: // Multiplicación tablas 1-15 (otro orden)
        a = rnd(1,15); b = rnd(1,10);
        ans = a*b; text = b + ' × ' + a + ' = ?';
        break;
      case 2: // División directa (resultado 1-15)
        ans = rnd(1,15); b = rnd(2,15); a = ans*b;
        text = a + ' ÷ ' + b + ' = ?';
        break;
      case 3: // División directa variante
        ans = rnd(2,12); b = rnd(2,10); a = ans*b;
        text = a + ' ÷ ' + b + ' = ?';
        break;
    }

  } else if (d === 'medium') {
    // ── INTERMEDIO: tablas 1-20, incógnitas, divisiones con incógnita ──
    const type = rnd(0, 5);
    switch(type) {
      case 0: // Multiplicación tablas 1-20
        a = rnd(2,20); b = rnd(2,20);
        ans = a*b; text = a + ' × ' + b + ' = ?';
        break;
      case 1: // Multiplicación con incógnita izquierda
        a = rnd(2,15); b = rnd(2,15);
        ans = a; text = '? × ' + b + ' = ' + (a*b);
        break;
      case 2: // Multiplicación con incógnita derecha
        a = rnd(2,15); b = rnd(2,15);
        ans = b; text = a + ' × ? = ' + (a*b);
        break;
      case 3: // División directa tablas hasta 20
        b = rnd(2,20); ans = rnd(2,20); a = b*ans;
        text = a + ' ÷ ' + b + ' = ?';
        break;
      case 4: // División con incógnita divisor
        b = rnd(2,15); ans = rnd(2,15); a = b*ans;
        text = a + ' ÷ ? = ' + ans; ans = b;
        break;
      case 5: // División con incógnita dividendo
        b = rnd(2,15); ans = rnd(2,15); a = b*ans;
        text = '? ÷ ' + b + ' = ' + ans; ans = a;
        break;
    }

  } else {
    // ── DIFÍCIL: tablas hasta 25, incógnitas, cuadrados, doble incógnita ──
    const type = rnd(0, 5);
    switch(type) {
      case 0: // Tablas grandes hasta 25
        a = rnd(10,25); b = rnd(10,25);
        ans = a*b; text = a + ' × ' + b + ' = ?';
        break;
      case 1: // Multiplicación con incógnita tablas grandes
        a = rnd(8,20); b = rnd(8,20);
        ans = a; text = '? × ' + b + ' = ' + (a*b);
        break;
      case 2: // División con incógnita dividendo tablas grandes
        b = rnd(8,20); ans = rnd(8,20); a = b*ans;
        text = '? ÷ ' + b + ' = ' + ans; ans = a;
        break;
      case 3: // División difícil
        b = rnd(12,25); ans = rnd(8,20); a = b*ans;
        text = a + ' ÷ ' + b + ' = ?';
        break;
      case 4: // Cuadrados (5² a 15²)
        a = rnd(5,15);
        ans = a*a; text = a + '² = ?';
        break;
      case 5: // Multiplicación de 3 factores pequeños
        a = rnd(2,8); b = rnd(2,8); { const c = rnd(2,5);
        ans = a*b*c; text = a + ' × ' + b + ' × ' + c + ' = ?'; }
        break;
    }
  }

  return { text, answer: Math.round(ans) };
}

/* ══════════════════════════════════════
   BROADCAST
══════════════════════════════════════ */
function broadcast(msg, exclude) {
  const raw = JSON.stringify(msg);
  for (const [ws] of clients) {
    if (ws !== exclude && ws.readyState === 1) ws.send(raw);
  }
}
function broadcastAll(msg) { broadcast(msg, null); }
function sendTo(ws, msg)   { if (ws.readyState===1) ws.send(JSON.stringify(msg)); }

function sendState(ws) {
  sendTo(ws, {
    type:  'state',
    qtext: G.qtext,
    pos:   G.pos,
    rnd:   G.rnd,
    sb:    G.sb,
    sr:    G.sr,
    over:  G.over,
    timer: G.timer,
    ib:    G.ib,
    ir:    G.ir
  });
}

function broadcastState() {
  const msg = {
    type:  'state',
    qtext: G.qtext,
    pos:   G.pos,
    rnd:   G.rnd,
    sb:    G.sb,
    sr:    G.sr,
    over:  G.over,
    timer: G.timer,
    ib:    G.ib,
    ir:    G.ir
  };
  broadcastAll(msg);
}

/* ══════════════════════════════════════
   TIMER
══════════════════════════════════════ */
const TS = 38;
function startTimer() {
  clearInterval(timerInterval);
  G.timer = TS;
  timerInterval = setInterval(() => {
    if (gamePaused) return;
    G.timer--;
    broadcastAll({ type: 'timer', value: G.timer });
    if (G.timer <= 0) {
      clearInterval(timerInterval);
      broadcastAll({ type: 'timeout' });
      setTimeout(() => nextQ(), 1000);
    }
  }, 1000);
}

function nextQ() {
  if (G.over) return;
  wrongThisQ = new Set();
  const q  = genQ();
  G.ans    = q.answer;
  G.qtext  = q.text;
  G.rnd   += 1;
  G.ib     = '';
  G.ir     = '';
  broadcastAll({ type: 'nextQ', qtext: G.qtext, rnd: G.rnd });
  startTimer();
}

/* ══════════════════════════════════════
   LÓGICA DE RESPUESTA
══════════════════════════════════════ */
const MA = 5, WT = 50;
let wrongThisQ = new Set(); // quién ya falló en la pregunta actual

function handleSubmit(team) {
  if (G.over) return;
  const buf = team === 'b' ? G.ib : G.ir;
  if (!buf) return;
  const val = parseInt(buf, 10);

  if (team === 'b') G.ib = ''; else G.ir = '';
  broadcastAll({ type: 'clearInput', team });

  if (val === G.ans) {
    clearInterval(timerInterval);
    wrongThisQ = new Set();
    if (team === 'b') { G.sb++; G.cb++; G.pos -= MA; }
    else              { G.sr++; G.cr++; G.pos += MA; }

    broadcastAll({ type: 'correct', team, sb: G.sb, sr: G.sr, pos: G.pos });

    if (Math.abs(G.pos) >= WT) {
      G.over = true;
      broadcastAll({ type: 'win', team, rnd: G.rnd, cb: G.cb, cr: G.cr });
    } else {
      setTimeout(() => nextQ(), 900);
    }
  } else {
    broadcastAll({ type: 'wrong', team });
    wrongThisQ.add(team);
    // Si los DOS equipos fallaron en esta pregunta → pasar a la siguiente
    if (wrongThisQ.has('b') && wrongThisQ.has('r')) {
      wrongThisQ = new Set();
      clearInterval(timerInterval);
      broadcastAll({ type: 'bothWrong' });
      setTimeout(() => nextQ(), 1200);
    }
  }
}

function handleInput(team, digit) {
  if (G.over) return;
  const k = team === 'b' ? 'ib' : 'ir';
  if (G[k].length >= 4) return;
  G[k] += digit;
  broadcastAll({ type: 'input', team, value: G[k] });
}

function handleDelete(team) {
  const k = team === 'b' ? 'ib' : 'ir';
  G[k] = G[k].slice(0, -1);
  broadcastAll({ type: 'input', team, value: G[k] });
}

/* ══════════════════════════════════════
   HTTP SERVER — sirve archivos estáticos
══════════════════════════════════════ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg'
};

const httpServer = http.createServer((req, res) => {
  let filePath;
  if (req.url === '/' || req.url === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else if (req.url === '/blue') {
    filePath = path.join(__dirname, 'blue.html');
  } else if (req.url === '/red') {
    filePath = path.join(__dirname, 'red.html');
  } else {
    filePath = path.join(__dirname, req.url);
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

/* ══════════════════════════════════════
   WEBSOCKET SERVER
══════════════════════════════════════ */
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  clients.set(ws, { type: null });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'register':
        clients.set(ws, { type: msg.role });
        if (!gameStarted) {
          sendTo(ws, { type: 'waiting' });
        } else {
          sendState(ws);
          // If game paused, notify the reconnected player
          if (gamePaused) sendTo(ws, { type: 'pause', paused: true });
        }
        console.log(`[+] Reconectado/Conectado: ${msg.role}`);
        // Only notify about actual players (not the screen itself)
        if (msg.role === 'blue' || msg.role === 'red') {
          broadcastAll({ type: 'playerJoined', role: msg.role });
        }
        break;

      case 'input':
        handleInput(msg.team, msg.digit);
        break;

      case 'delete':
        handleDelete(msg.team);
        break;

      case 'submit':
        handleSubmit(msg.team);
        break;

      case 'restart':
        clearInterval(timerInterval);
        G = freshState();
        gameStarted = false;
        gamePaused = false;
        broadcastAll({ type: 'waiting' });
        break;

      case 'ping': break; // heartbeat

      case 'pause':
        gamePaused = !gamePaused;
        broadcastAll({ type: 'pause', paused: gamePaused });
        break;

      case 'startGame':
        if (!gameStarted) {
          gameDifficulty = msg.difficulty || 'easy';
          gameStarted = true;
          gamePaused = false;
          G = freshState();
          broadcastAll({ type: 'restart', qtext: G.qtext });
          startTimer();
        }
        break;
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      console.log(`[-] Desconectado: ${info.type}`);
      broadcastAll({ type: 'playerLeft', role: info.type });
      // Si el profesor (pantalla) se desconecta, pausar y reiniciar el juego
      if (info.type === 'screen') {
        clearInterval(timerInterval);
        G = freshState();
        gameStarted = false;
        gamePaused = false;
        // Notificar a los jugadores que la sesión terminó
        setTimeout(() => broadcastAll({ type: 'hostLeft' }), 300);
        console.log('[*] Profesor desconectado — juego reiniciado');
      }
    }
    clients.delete(ws);
    // Si no quedan clientes, reiniciar estado
    if (clients.size === 0) {
      clearInterval(timerInterval);
      G = freshState();
      gameStarted = false;
      gamePaused = false;
      console.log('[*] Todos desconectados — juego reiniciado');
    }
  });
});

/* ── Arrancar ── */
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   TUG OF WAR — Servidor Online       ║');
  console.log('╠══════════════════════════════════════╣');

  // Mostrar IPs disponibles
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`║  📺 Pantalla : http://${net.address}:${PORT}         `);
        console.log(`║  📱 Equipo 1 : http://${net.address}:${PORT}/blue    `);
        console.log(`║  📱 Equipo 2 : http://${net.address}:${PORT}/red     `);
        console.log('╚══════════════════════════════════════╝');
      }
    }
  }
  console.log('');
});

// El juego espera a que alguien presione Iniciar
