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
  let a, b, c, g, ans, text;
  const E = d==='easy', H = d==='hard';

  switch(topic) {

    /* ════════════════════════════════
       SUMA  — 8 tipos de ejercicio
    ════════════════════════════════ */
    case 'suma': {
      // Rangos claros por dificultad
      const [lo,hi] = E?[1,30] : H?[100,9999] : [10,999];
      const t = rnd(0, 6);
      if(t===0){ // a+b directa
        a=rnd(lo,hi); b=rnd(lo,hi);
        ans=a+b; text=a+' + '+b+' = ?';
      } else if(t===1){ // incógnita sumando
        a=rnd(lo,hi); b=rnd(lo,hi);
        ans=b; text=a+' + ? = '+(a+b);
      } else if(t===2){ // incógnita primer sumando
        a=rnd(lo,hi); b=rnd(lo,hi);
        ans=a; text='? + '+b+' = '+(a+b);
      } else if(t===3){ // 3 sumandos
        a=rnd(lo,Math.min(hi,E?20:H?999:200)); b=rnd(lo,Math.min(hi,E?20:H?999:200)); c=rnd(lo,Math.min(hi,E?20:H?999:200));
        ans=a+b+c; text=a+' + '+b+' + '+c+' = ?';
      } else if(t===4){ // múltiplos de 10
        a=rnd(1,E?9:H?90:30)*10; b=rnd(1,E?9:H?90:30)*10;
        ans=a+b; text=a+' + '+b+' = ?';
      } else if(t===5){ // completar a número redondo
        const meta = E?100 : H?10000 : 1000;
        a=rnd(E?10:H?1000:100, E?90:H?9000:900);
        a=Math.round(a/10)*10; ans=meta-a; text=a+' + ? = '+meta;
      } else { // suma de 4 números
        a=rnd(lo,E?15:H?500:100); b=rnd(lo,E?15:H?500:100);
        c=rnd(lo,E?15:H?500:100); const dd=rnd(lo,E?15:H?500:100);
        ans=a+b+c+dd; text=a+' + '+b+' + '+c+' + '+dd+' = ?';
      }
      break;
    }

    /* ════════════════════════════════
       RESTA — 8 tipos
    ════════════════════════════════ */
    case 'resta': {
      const t = rnd(0, E?3:H?7:5);
      if(t===0){ // a-b directa
        a=rnd(E?5:H?200:20, E?50:H?9999:500); b=rnd(1,a);
        ans=a-b; text=a+' - '+b+' = ?';
      } else if(t===1){ // incógnita sustraendo
        a=rnd(E?5:H?200:20, E?50:H?9999:500); b=rnd(1,a); ans=a-b;
        text=a+' - ? = '+ans; ans=b;
      } else if(t===2){ // incógnita minuendo
        b=rnd(1,E?20:H?500:100); ans=rnd(1,E?20:H?500:100); a=ans+b;
        text='? - '+b+' = '+ans;
      } else if(t===3){ // resta con cero
        a=rnd(1,E?100:H?9999:999);
        ans=a; text=a+' - 0 = ?';
      } else if(t===4){ // resta doble dígito
        a=rnd(50,E?99:H?999:500); b=rnd(10,a-10);
        ans=a-b; text=a+' - '+b+' = ?';
      } else if(t===5){ // múltiplos de 100
        a=rnd(2,H?90:20)*100; b=rnd(1,a/100-1)*100;
        ans=a-b; text=a+' - '+b+' = ?';
      } else if(t===6){ // resta consecutiva
        a=rnd(100,H?999:500); b=rnd(10,50); c=rnd(5,30);
        ans=a-b-c; text=a+' - '+b+' - '+c+' = ?';
      } else { // completar diferencia
        b=rnd(1,H?500:100); ans=rnd(1,H?500:100); a=ans+b;
        text='¿Cuánto le falta a '+b+' para llegar a '+a+'?'; ans=ans;
      }
      break;
    }

    /* ════════════════════════════════
       MULTIPLICACIÓN — 10 tipos
    ════════════════════════════════ */
    case 'multi': {
      // Rangos por dificultad
      const [lo,hi] = E?[2,15] : H?[6,25] : [2,20];
      const t = rnd(0, 7);
      if(t===0){ // directa
        a=rnd(lo,hi); b=rnd(lo,hi); ans=a*b; text=a+' × '+b+' = ?';
      } else if(t===1){ // incógnita izquierda
        a=rnd(lo,hi); b=rnd(lo,hi); ans=a; text='? × '+b+' = '+(a*b);
      } else if(t===2){ // incógnita derecha
        a=rnd(lo,hi); b=rnd(lo,hi); ans=b; text=a+' × ? = '+(a*b);
      } else if(t===3){ // 3 factores
        a=rnd(lo,E?8:hi); b=rnd(lo,E?8:hi); c=rnd(2,E?5:8);
        ans=a*b*c; text=a+' × '+b+' × '+c+' = ?';
      } else if(t===4){ // ×10
        a=rnd(lo,hi); ans=a*10; text=a+' × 10 = ?';
      } else if(t===5){ // ×100 — solo medium/hard
        a=rnd(lo,hi); ans=E?a*10:a*100; text=a+(E?' × 10':' × 100')+' = ?';
      } else if(t===6){ // "Si b×x=..." forma problema
        a=rnd(lo,hi); b=rnd(lo,hi); ans=a; text='Si '+b+' × x = '+(a*b)+',  x = ?';
      } else { // cuadrado (solo medium/hard)
        a=rnd(E?2:H?8:4, E?9:H?15:12); ans=a*a; text=a+'² = ?';
      }
      break;
    }

    /* ════════════════════════════════
       DIVISIÓN — 9 tipos
    ════════════════════════════════ */
    case 'div': {
      const max = E?15:H?25:20;
      const t = rnd(0, E?3:H?8:5);
      if(t===0){ b=rnd(2,max); ans=rnd(2,max); a=b*ans; text=a+' ÷ '+b+' = ?'; }
      else if(t===1){ b=rnd(2,max); ans=rnd(2,max); a=b*ans; text=a+' ÷ ? = '+ans; ans=b; }
      else if(t===2){ b=rnd(2,max); ans=rnd(2,max); a=b*ans; text='? ÷ '+b+' = '+ans; ans=a; }
      else if(t===3){ ans=rnd(2,10); text=ans*10+' ÷ 10 = ?'; }
      else if(t===4){ ans=rnd(2,10); text=ans*100+' ÷ 100 = ?'; }
      else if(t===5){ b=rnd(2,max); ans=rnd(2,max); a=b*ans; text='Si '+a+' ÷ x = '+b+', entonces x = ?'; ans=ans; }
      else if(t===6){ b=rnd(2,max); ans=rnd(2,max); a=b*ans; text='Reparte '+a+' en '+b+' grupos iguales: ?'; }
      else if(t===7){ b=rnd(2,9); ans=rnd(2,12); a=b*ans; text='¿Cuántas veces cabe '+b+' en '+a+'?'; }
      else { b=rnd(2,max); ans=rnd(2,max); a=b*ans; text=a+' entre '+b+' = ?'; }
      break;
    }

    /* ════════════════════════════════
       POTENCIAS — 8 tipos
    ════════════════════════════════ */
    case 'potencias': {
      const t = rnd(0, E?3:H?7:5);
      if(t===0){ a=rnd(E?2:2, E?5:H?12:9); b=E?2:rnd(2,H?4:3); ans=Math.pow(a,b); text=a+'^'+b+' = ?'; }
      else if(t===1){ b=E?2:rnd(2,3); ans=rnd(2,E?5:H?10:8); text='?^'+b+' = '+Math.pow(ans,b); }
      else if(t===2){ a=rnd(2,H?10:7); ans=rnd(2,H?4:3); text=a+'^? = '+Math.pow(a,ans); }
      else if(t===3){ a=rnd(2,10); ans=a*a; text='Cuadrado de '+a+' = ?'; }
      else if(t===4){ a=rnd(2,8); ans=a*a*a; text='Cubo de '+a+' = ?'; }
      else if(t===5){ a=rnd(2,9); ans=1; text=a+'^0 = ?'; }
      else if(t===6){ a=rnd(2,10); ans=a; text=a+'^1 = ?'; }
      else { // comparar potencias
        a=rnd(2,6); b=rnd(2,4); c=rnd(2,6); const dd=rnd(2,4);
        const va=Math.pow(a,b), vb=Math.pow(c,dd);
        ans=Math.max(va,vb); text='Mayor entre '+a+'^'+b+' y '+c+'^'+dd+' = ?';
      }
      break;
    }

    /* ════════════════════════════════
       RAÍCES CUADRADAS — 7 tipos
    ════════════════════════════════ */
    case 'raices': {
      const maxR = E?10:H?20:15;
      const t = rnd(0, E?2:H?5:4);
      if(t===0){ a=rnd(2,maxR); ans=a; text='√'+(a*a)+' = ?'; }
      else if(t===1){ a=rnd(2,maxR); ans=a*a; text='Si √x = '+a+',  x = ?'; }
      else if(t===2){ a=rnd(2,10); ans=a; text='¿Cuál número al cuadrado da '+(a*a)+'?'; }
      else if(t===3){ a=rnd(2,maxR); ans=2*a; text='√'+(a*a)+' + √'+(a*a)+' = ?'; }
      else if(t===4){ a=rnd(2,10); b=rnd(2,10); ans=a+b; text='√'+(a*a)+' + √'+(b*b)+' = ?'; }
      else { a=rnd(2,maxR); b=rnd(1,a-1); ans=a-b; text='√'+(a*a)+' - √'+(b*b)+' = ?'; }
      break;
    }

    /* ════════════════════════════════
       FRACCIONES — 10 tipos
    ════════════════════════════════ */
    case 'fracciones': {
      const t = rnd(0, E?4:H?9:6);
      if(t===0){ // suma mismo denominador
        const den=rnd(2,E?8:12); const n1=rnd(1,den-1), n2=rnd(1,den-1);
        ans=n1+n2; text=n1+'/'+den+' + '+n2+'/'+den+' = ?/'+den;
      } else if(t===1){ // resta mismo denominador
        const den=rnd(3,E?8:12); const n1=rnd(2,den), n2=rnd(1,n1-1);
        ans=n1-n2; text=n1+'/'+den+' - '+n2+'/'+den+' = ?/'+den;
      } else if(t===2){ // fracción de entero
        b=rnd(2,E?5:8); a=rnd(1,b-1); const tot=rnd(2,E?10:20)*b;
        ans=tot/b*a; text=a+'/'+b+' de '+tot+' = ?';
      } else if(t===3){ // simplificar — ¿cuál es el numerador?
        g=rnd(2,5); a=rnd(2,7); b=rnd(2,7);
        ans=a; text=(a*g)+'/'+(b*g)+' simplificado = ?/'+b;
      } else if(t===4){ // fracción equivalente
        g=rnd(2,6); a=rnd(1,6); b=rnd(2,8);
        ans=a*g; text=a+'/'+b+' = ?/'+(b*g);
      } else if(t===5){ // multiplicación fracción × entero
        a=rnd(1,6); b=rnd(2,8); c=rnd(2,6);
        ans=a*c; text=a+'/'+b+' × '+b*c+' = ?';
      } else if(t===6){ // comparar — ¿cuál es mayor numerador para igualar?
        const den=rnd(3,10); a=rnd(1,den-1);
        ans=den-a; text='¿Qué número le falta a '+a+'/'+den+' para ser 1 entero?  '+a+'/'+den+' + ?/'+den+' = 1';
      } else if(t===7){ // fracción impropia a mixto
        b=rnd(2,6); c=rnd(1,b-1); a=rnd(2,5)*b+c;
        ans=Math.floor(a/b); text=a+'/'+b+' = ? enteros y '+c+'/'+b;
      } else if(t===8){ // denominador faltante
        g=rnd(2,5); a=rnd(1,6); b=rnd(2,8);
        ans=b*g; text=a+'/'+b+' = '+(a*g)+'/? ';
      } else { // suma diferente denominador (múltiplos)
        b=rnd(2,6); const den2=b*rnd(2,4);
        const n1=rnd(1,b-1), n2=rnd(1,den2-1);
        ans=Math.round((n1/b+n2/den2)*den2); text=n1+'/'+b+' + '+n2+'/'+den2+' = ?/'+den2;
      }
      break;
    }

    /* ════════════════════════════════
       PORCENTAJES — 9 tipos
    ════════════════════════════════ */
    case 'porcentajes': {
      const pcts = E?[10,20,25,50]:H?[5,15,30,40,60,75,80]:[10,20,25,50,30,15];
      const pct = pick(pcts);
      const tot = (E?rnd(2,20):H?rnd(5,80):rnd(2,40))*10;
      const t = rnd(0, E?2:H?8:5);
      if(t===0){ ans=tot*pct/100; text=pct+'% de '+tot+' = ?'; }
      else if(t===1){ ans=pct; text='¿Qué % de '+tot+' es '+(tot*pct/100)+'?'; }
      else if(t===2){ ans=tot; text=pct+'% de ? = '+(tot*pct/100); }
      else if(t===3){ ans=tot+tot*pct/100; text='Precio '+tot+' con '+pct+'% de aumento = ?'; }
      else if(t===4){ ans=tot-tot*pct/100; text='Precio '+tot+' con '+pct+'% de descuento = ?'; }
      else if(t===5){ const res=tot*pct/100; ans=tot; text='Si el '+pct+'% de un número es '+res+', el número es ?'; }
      else if(t===6){ ans=Math.round(tot*pct/100); text='Descuento del '+pct+'% sobre $'+tot+' = $?'; }
      else if(t===7){ const nota=rnd(1,9)*10; ans=Math.round(nota/tot*100); text='¿Qué % es '+nota+' de '+tot+'?'; }
      else { ans=pct/100*tot; text='Halla el '+pct+'% de '+tot; }
      break;
    }

    /* ════════════════════════════════
       ÁLGEBRA BÁSICA — 10 tipos
    ════════════════════════════════ */
    case 'algebra': {
      const t = rnd(0, E?4:H?9:7);
      const xval = E?rnd(1,15):H?rnd(5,30):rnd(2,20);
      const coef = E?rnd(2,5):H?rnd(4,10):rnd(2,7);
      const bval = E?rnd(1,15):H?rnd(5,25):rnd(1,15);
      if(t===0){ ans=xval; text='x + '+bval+' = '+(xval+bval)+',  x = ?'; }
      else if(t===1){ ans=xval; text='x - '+bval+' = '+(xval-bval)+',  x = ?'; }
      else if(t===2){ ans=xval; text=coef+'x = '+(coef*xval)+',  x = ?'; }
      else if(t===3){ ans=xval; text=coef+'x + '+bval+' = '+(coef*xval+bval)+',  x = ?'; }
      else if(t===4){ ans=xval; text=coef+'x - '+bval+' = '+(coef*xval-bval)+',  x = ?'; }
      else if(t===5){ ans=xval; text='x/'+coef+' = '+Math.floor(xval/coef)+',  x = ?'; ans=coef*Math.floor(xval/coef); }
      else if(t===6){ ans=xval; text='2x + '+bval+' = '+(2*xval+bval)+',  x = ?'; }
      else if(t===7){ ans=xval; text='3x - '+bval+' = '+(3*xval-bval)+',  x = ?'; }
      else if(t===8){ ans=xval; text=coef+'(x + '+bval+') = '+(coef*(xval+bval))+',  x = ?'; }
      else { ans=xval; text='Si f(x)='+coef+'x+'+bval+' y f(x)='+(coef*xval+bval)+', x=?'; }
      break;
    }

    /* ════════════════════════════════
       ÁLGEBRA INTERMEDIA — 8 tipos
    ════════════════════════════════ */
    case 'algebra2': {
      const t = rnd(0, H?7:5);
      if(t===0){ // MCD
        g=rnd(2,H?15:9); a=g*rnd(2,8); b=g*rnd(2,8);
        ans=g; text='MCD('+a+', '+b+') = ?';
      } else if(t===1){ // MCM
        a=rnd(2,H?12:8); b=rnd(2,H?12:8); g=a*b/gcd(a,b);
        ans=g; text='MCM('+a+', '+b+') = ?';
      } else if(t===2){ // (a+b)² → término medio
        a=rnd(2,9); b=rnd(2,9);
        ans=2*a*b; text='('+a+'+'+b+')²  →  2ab = ?';
      } else if(t===3){ // diferencia de cuadrados
        a=rnd(2,12); b=rnd(2,a-1);
        ans=a+b; text='('+a+'²-'+b+'²) ÷ ('+(a-b)+') = ?';
      } else if(t===4){ // a²-b² factorizar
        a=rnd(3,10); b=rnd(2,a-1);
        ans=a-b; text='√('+(a*a-b*b)+') ÷ √('+(a+b)+') = ?';
      } else if(t===5){ // (a-b)² → término independiente
        a=rnd(2,9); b=rnd(2,9);
        ans=b*b; text='('+a+'-'+b+')²  →  b² = ?';
      } else if(t===6){ // suma de cuadrados perfectos
        a=rnd(2,8); b=rnd(2,8);
        ans=a*a+b*b; text=a+'² + '+b+'² = ?';
      } else { // valor de expresión
        a=rnd(2,8); b=rnd(1,5); const xv=rnd(1,6);
        ans=a*xv+b; text='Si x='+xv+', entonces '+a+'x+'+b+' = ?';
      }
      break;
    }

    /* ════════════════════════════════
       ECUACIONES 2° GRADO — 7 tipos
    ════════════════════════════════ */
    case 'ecuaciones': {
      const t = rnd(0, H?6:4);
      // Generar raíces enteras pequeñas
      const r1=rnd(H?-8:-6, H?8:6), r2=rnd(H?-8:-6, H?8:6);
      const B=-(r1+r2), C=r1*r2;
      const sgB = B>=0?'+':'', sgC = C>=0?'+':'';
      if(t===0){ ans=r1; text='x²'+sgB+B+'x'+sgC+C+'=0  (una raíz es '+r2+')  x=?'; }
      else if(t===1){ ans=r1+r2; text='x²'+sgB+B+'x'+sgC+C+'=0  → suma de raíces = ?'; }
      else if(t===2){ ans=r1*r2; text='x²'+sgB+B+'x'+sgC+C+'=0  → producto de raíces = ?'; }
      else if(t===3){ // ecuación tipo x²=k
        a=rnd(2,H?12:9); ans=a; text='x² = '+(a*a)+',  x positivo = ?';
      } else if(t===4){ // (x+a)(x+b)=0
        a=rnd(1,8); b=rnd(1,8);
        ans=-a; text='(x+'+a+')(x+'+b+')=0  → una solución x=?';
      } else if(t===5){ // discriminante
        text='x²'+sgB+B+'x'+sgC+C+'=0  → discriminante b²-4ac = ?';
        ans=B*B-4*C;
      } else { // despejando
        a=rnd(2,8); b=rnd(1,20);
        ans=rnd(2,8); const lhs=ans*ans*a-b;
        text=a+'x² - '+b+' = '+lhs+',  x positivo = ?';
      }
      break;
    }

    /* ════════════════════════════════
       TRIGONOMETRÍA — 8 tipos
    ════════════════════════════════ */
    case 'trigono': {
      const angleSet = E?[[0,30,90],[0,90]]:[[0,30,45,60,90],[0,30,45,60,90]];
      const degs = pick(angleSet);
      const deg = pick(degs);
      const sinV={0:'0',30:'1/2',45:'√2/2',60:'√3/2',90:'1'};
      const cosV={0:'1',30:'√3/2',45:'√2/2',60:'1/2',90:'0'};
      const tanV={0:'0',30:'√3/3',45:'1',60:'√3',90:'∞'};
      const t = rnd(0, E?1:H?7:4);
      if(t===0){ ans=sinV[deg]; text='sen('+deg+'°) = ?'; }
      else if(t===1){ ans=cosV[deg]; text='cos('+deg+'°) = ?'; }
      else if(t===2){ ans=tanV[deg]; text='tan('+deg+'°) = ?'; }
      else if(t===3){ // identidad sin²+cos²=1
        const d2=pick([30,45,60]);
        const sv=parseFloat(sinV[d2]==='1/2'?0.5:sinV[d2]==='√2/2'?0.707:0.866);
        ans=1; text='sen²('+d2+'°) + cos²('+d2+'°) = ?';
      } else if(t===4){ // ángulo complementario
        const d2=pick([30,60]); const comp=90-d2;
        ans=sinV[comp]; text='cos('+d2+'°) = sen(?°)  → ? = ?'; ans=comp;
      } else if(t===5){ // seno doble ángulo conceptual
        ans=sinV[deg]; text='¿Cuánto vale sen('+deg+'°)?';
      } else if(t===6){ ans=cosV[deg]; text='¿Cuánto vale cos('+deg+'°)?'; }
      else { ans=tanV[deg]; text='¿Cuánto vale tan('+deg+'°)?'; }
      return { text, answer: String(ans), textAnswer: true };
    }

    /* ════════════════════════════════
       LOGARITMOS — 8 tipos
    ════════════════════════════════ */
    case 'logaritmos': {
      const bases = E?[2,10]:H?[2,3,5,10]:[2,10];
      const base = pick(bases);
      const exp2 = E?rnd(1,5):H?rnd(1,8):rnd(1,6);
      const val  = Math.pow(base, exp2);
      const t = rnd(0, E?2:H?7:4);
      if(t===0){ ans=exp2; text='log_'+base+'('+val+') = ?'; }
      else if(t===1){ ans=val; text='log_'+base+'(?) = '+exp2; }
      else if(t===2){ ans=exp2; text='log_'+base+'('+base+'^'+exp2+') = ?'; }
      else if(t===3){ ans=0; text='log_'+base+'(1) = ?'; }
      else if(t===4){ ans=1; text='log_'+base+'('+base+') = ?'; }
      else if(t===5){ // log(a×b) = log(a)+log(b)
        const e1=rnd(1,4), e2=rnd(1,4);
        ans=e1+e2; text='log_'+base+'('+Math.pow(base,e1)+') + log_'+base+'('+Math.pow(base,e2)+') = ?';
      } else if(t===6){ // log(a/b) = log(a)-log(b)
        const e1=rnd(2,6), e2=rnd(1,e1-1);
        ans=e1-e2; text='log_'+base+'('+Math.pow(base,e1)+') - log_'+base+'('+Math.pow(base,e2)+') = ?';
      } else { // n×log = log de potencia
        const e1=rnd(1,4), e2=rnd(2,4);
        ans=e1*e2; text=e2+' × log_'+base+'('+Math.pow(base,e1)+') = ?';
      }
      break;
    }

    default:
      a=rnd(2,10); b=rnd(2,10); ans=a*b; text=a+' × '+b+' = ?';
  }
  return { text, answer: Math.round(Number(ans)) };
}

// Helper MCD (máximo común divisor)
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

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
