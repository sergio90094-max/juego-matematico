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
let gameDifficulty = 'easy';   // 'easy' | 'medium' | 'hard'
let gameTopics = ['suma','resta','multi','div']; // temas activos

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
function pick(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

function genByTopic(topic, d) {
  let a, b, c, ans, text;
  const E = d==='easy', H = d==='hard';

  switch(topic) {

    case 'suma': {
      const max = E?20 : H?9999:999;
      const min = E?1  : H?100 :10;
      a=rnd(min,max); b=rnd(min,max);
      const ops = E ? [0] : H ? [0,1,2] : [0,1];
      switch(pick(ops)) {
        case 0: ans=a+b; text=a+' + '+b+' = ?'; break;
        case 1: ans=a+b+rnd(min,max); a=ans-rnd(1,a); text=a+' + ? = '+ans; ans=ans-a; break;
        case 2: // 3 sumandos
          c=rnd(min,max); ans=a+b+c; text=a+' + '+b+' + '+c+' = ?'; break;
      }
      break;
    }

    case 'resta': {
      const max = E?20 : H?9999:999;
      const min = E?1  : H?100 :10;
      a=rnd(min,max); b=rnd(1,a);
      const ops = E ? [0] : H ? [0,1,2] : [0,1];
      switch(pick(ops)) {
        case 0: ans=a-b; text=a+' - '+b+' = ?'; break;
        case 1: ans=a-b; text=a+' - ? = '+ans; ans=b; break;
        case 2: ans=a-b; text='? - '+b+' = '+ans; ans=a; break;
      }
      break;
    }

    case 'multi': {
      const max = E?15 : H?25:20;
      a=rnd(2,max); b=rnd(2,max);
      const ops = E ? [0] : H ? [0,1,2,3] : [0,1,2];
      switch(pick(ops)) {
        case 0: ans=a*b; text=a+' × '+b+' = ?'; break;
        case 1: ans=a; text='? × '+b+' = '+(a*b); break;
        case 2: ans=b; text=a+' × ? = '+(a*b); break;
        case 3: c=rnd(2,8); ans=a*b*c; text=a+' × '+b+' × '+c+' = ?'; break;
      }
      break;
    }

    case 'div': {
      const max = E?15 : H?25:20;
      b=rnd(2,max); ans=rnd(2,max); a=b*ans;
      const ops = E ? [0] : H ? [0,1,2] : [0,1];
      switch(pick(ops)) {
        case 0: text=a+' ÷ '+b+' = ?'; break;
        case 1: text=a+' ÷ ? = '+ans; ans=b; break;
        case 2: text='? ÷ '+b+' = '+ans; ans=a; break;
      }
      break;
    }

    case 'potencias': {
      const base = E?rnd(2,5) : H?rnd(2,12):rnd(2,9);
      const exp  = E?2        : H?rnd(2,4)  :rnd(2,3);
      const ops  = E?[0]      : H?[0,1,2]   :[0,1];
      switch(pick(ops)) {
        case 0: ans=Math.pow(base,exp); text=base+'^ '+exp+' = ?'; break;
        case 1: ans=base; text='?^ '+exp+' = '+Math.pow(base,exp); break;
        case 2: ans=exp;  text=base+'^ ? = '+Math.pow(base,exp); break;
      }
      break;
    }

    case 'raices': {
      const maxR = E?7 : H?15:12;
      a = rnd(2, maxR); ans = a; a = a*a;
      const ops = E?[0] : H?[0,1]:[0];
      switch(pick(ops)){
        case 0: text='√'+a+' = ?'; break;
        case 1: ans=a; text='√? = '+Math.sqrt(a); ans=a; break;
      }
      break;
    }

    case 'fracciones': {
      const max = E?6 : H?12:9;
      a=rnd(1,max); b=rnd(2,max); c=rnd(1,max); const d2=rnd(2,max);
      const ops = E?[0,1] : H?[0,1,2,3]:[0,1,2];
      switch(pick(ops)){
        case 0: // suma mismos denominadores
          { const den=rnd(2,max); const n1=rnd(1,den-1), n2=rnd(1,den-1);
            ans=n1+n2; text=n1+'/'+den+' + '+n2+'/'+den+' = ?/'+den; break; }
        case 1: // multiplicar fracción × entero
          { ans=a*b; text=a+'/'+b+' × '+b*2+' = ?'; ans=a*2; break; }
        case 2: // simplificar
          { const g=rnd(2,5); ans=a; text=(a*g)+'/'+(b*g)+' simplificado = '+a+'/'+b+'  ¿?='; ans=a; text=(a*g)+'/'+(b*g)+' = ?/'+b; break; }
        case 3: // fracción de número
          { const tot=rnd(10,50)*b; ans=tot/b*a; text=a+'/'+b+' de '+tot+' = ?'; break; }
      }
      break;
    }

    case 'porcentajes': {
      const pcts = E?[10,20,25,50] : H?[5,15,30,40,60,75]:[10,20,25,50,30];
      const pct  = pick(pcts);
      const tot  = E?rnd(2,20)*10  : H?rnd(5,50)*10 : rnd(2,20)*10;
      const ops  = E?[0]           : H?[0,1,2]       : [0,1];
      switch(pick(ops)){
        case 0: ans=tot*pct/100; text=pct+'% de '+tot+' = ?'; break;
        case 1: ans=pct; text='¿Qué % de '+tot+' es '+(tot*pct/100)+'?'; break;
        case 2: ans=tot; text=pct+'% de ? = '+(tot*pct/100); break;
      }
      break;
    }

    case 'algebra': {
      // 2x+b=c  o  x-b=c  o  x/b=c
      const coef = E?1 : H?rnd(3,9):rnd(2,6);
      const xval = E?rnd(1,10) : H?rnd(5,30):rnd(2,20);
      const bval = E?rnd(1,10) : H?rnd(5,25):rnd(1,15);
      const ops  = E?[0,2] : H?[0,1,2,3]:[0,1,2];
      switch(pick(ops)){
        case 0: ans=xval; text=coef+'x + '+bval+' = '+(coef*xval+bval)+', x = ?'; break;
        case 1: ans=xval; text=coef+'x - '+bval+' = '+(coef*xval-bval)+', x = ?'; break;
        case 2: ans=xval; text='x + '+bval+' = '+(xval+bval)+', x = ?'; break;
        case 3: ans=xval; text=coef+'x = '+(coef*xval)+', x = ?'; break;
      }
      break;
    }

    case 'algebra2': {
      // Productos notables, factorización parcial
      const ops = [0,1,2];
      switch(pick(ops)){
        case 0: // (a+b)² = a²+2ab+b²  — dar a,b pedir 2ab
          { a=rnd(2,9); b=rnd(2,9); ans=2*a*b; text='('+a+'+'+b+')² → el término del medio 2ab = ?'; break; }
        case 1: // diferencia de cuadrados a²-b²=(a+b)(a-b) → dar resultado pedir factor
          { a=rnd(2,12); b=rnd(2,a-1); ans=a+b; text=(a*a-b*b)+' = ('+a+'-'+b+')(? ) → ? = ?'; ans=a+b; text='('+a+'²-'+b+'²) ÷ ('+(a-b)+') = ?'; break; }
        case 2: // mcd
          { const g=rnd(2,9); a=g*rnd(2,8); b=g*rnd(2,8); ans=g; text='MCD('+a+', '+b+') = ?'; break; }
      }
      break;
    }

    case 'ecuaciones': {
      // ax²+bx+c=0 con raíces enteras pequeñas
      const r1 = rnd(-8,8), r2 = rnd(-8,8);
      const A=1, B=-(r1+r2), C=r1*r2;
      const ops = [0,1];
      switch(pick(ops)){
        case 0: ans=r1; text='x²'+(B>=0?'+':'')+B+'x'+(C>=0?'+':'')+C+'=0  → una raíz es '+r2+', la otra x=?'; break;
        case 1: ans=Math.abs(r1)+Math.abs(r2); text='x²'+(B>=0?'+':'')+B+'x'+(C>=0?'+':'')+C+'=0  → suma |raíces| = ?'; break;
      }
      break;
    }

    case 'trigono': {
      // valores exactos de 0°,30°,45°,60°,90°
      const angles = E?[[0,'0'],[90,'90']] : [[0,'0'],[30,'30'],[45,'45'],[60,'60'],[90,'90']];
      const [deg, label] = pick(angles);
      const rad = deg*Math.PI/180;
      const funcs = E?['sen','cos'] : H?['sen','cos','tan']  :['sen','cos'];
      const fn = pick(funcs);
      const vals = {sen:{0:0,30:'1/2',45:'√2/2',60:'√3/2',90:1}, cos:{0:1,30:'√3/2',45:'√2/2',60:'1/2',90:0}, tan:{0:0,30:'√3/3',45:1,60:'√3',90:'∞'}};
      ans = String(vals[fn][deg]);
      text = fn+'('+label+'°) = ?';
      return { text, answer: ans, textAnswer: true };
    }

    case 'logaritmos': {
      const bases = E?[2,10] : H?[2,3,5,10]:[2,10];
      const base  = pick(bases);
      const exp2  = E?rnd(1,5) : H?rnd(1,8):rnd(1,6);
      const val   = Math.pow(base,exp2);
      const ops   = E?[0] : H?[0,1,2]:[0,1];
      switch(pick(ops)){
        case 0: ans=exp2; text='log_'+base+'('+val+') = ?'; break;
        case 1: ans=val;  text='log_'+base+'(?) = '+exp2; break;
        case 2: ans=exp2; text='log_'+base+'('+base+'^ '+exp2+') = ?'; break;
      }
      break;
    }

    default:
      a=rnd(2,10); b=rnd(2,10); ans=a*b; text=a+' × '+b+' = ?';
  }
  return { text, answer: Math.round(Number(ans)) };
}

function genQ() {
  // Elegir un tema al azar de los activos
  const topic = pick(gameTopics);
  const result = genByTopic(topic, gameDifficulty);
  return result;
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
    if (!msg || !msg.type) return;

    switch (msg.type) {

      case 'ping': return; // heartbeat — no hacer nada

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
          gameTopics     = (msg.topics && msg.topics.length) ? msg.topics : ['suma','resta','multi','div'];
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

// ── Evitar que errores no capturados tiren el servidor ──
process.on('uncaughtException',  err => console.error('[uncaughtException]', err.message));
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
