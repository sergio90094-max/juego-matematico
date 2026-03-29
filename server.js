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
       SUMA
       Fácil:   a + b,  números 1-20
       Medio:   a + b con números mayores, múltiplos de 10, completar a 100/1000, 3 sumandos
       Difícil: incógnitas, 4 sumandos, números grandes hasta 9999
    ════════════════════════════════ */
    case 'suma': {
      if (E) {
        a=rnd(1,20); b=rnd(1,20);
        ans=a+b; text=a+' + '+b+' = ?';
      } else if (H) {
        const t=rnd(0,5);
        if(t===0){ a=rnd(500,9999); b=rnd(500,9999); ans=a+b; text=a+' + '+b+' = ?'; }
        else if(t===1){ a=rnd(100,5000); b=rnd(100,5000); ans=b; text=a+' + ? = '+(a+b); }
        else if(t===2){ a=rnd(100,5000); b=rnd(100,5000); ans=a; text='? + '+b+' = '+(a+b); }
        else if(t===3){ a=rnd(100,2000); b=rnd(100,2000); c=rnd(100,2000); ans=a+b+c; text=a+' + '+b+' + '+c+' = ?'; }
        else if(t===4){ a=rnd(10,90)*100; b=rnd(10,90)*100; ans=a+b; text=a+' + '+b+' = ?'; }
        else { a=rnd(100,999); b=rnd(100,999); c=rnd(100,999); const dd=rnd(100,999); ans=a+b+c+dd; text=a+' + '+b+' + '+c+' + '+dd+' = ?'; }
      } else {
        const t=rnd(0,4);
        if(t===0){ a=rnd(10,99); b=rnd(10,99); ans=a+b; text=a+' + '+b+' = ?'; }
        else if(t===1){ a=rnd(10,99); b=rnd(10,99); ans=b; text=a+' + ? = '+(a+b); }
        else if(t===2){ a=rnd(10,999); b=rnd(10,999); c=rnd(10,999); ans=a+b+c; text=a+' + '+b+' + '+c+' = ?'; }
        else if(t===3){ a=rnd(1,9)*10; b=rnd(1,9)*10; ans=a+b; text=a+' + '+b+' = ?'; }
        else { const meta=1000; a=Math.round(rnd(100,900)/10)*10; ans=meta-a; text=a+' + ? = '+meta; }
      }
      break;
    }

    /* ════════════════════════════════
       RESTA
       Fácil:   a - b directa, números 1-20, resultado >= 0
       Medio:   restas medianas, incógnita sustraendo, múltiplos de 10/100
       Difícil: incógnita minuendo, resta consecutiva, números grandes
    ════════════════════════════════ */
    case 'resta': {
      if (E) {
        a=rnd(2,20); b=rnd(1,a);
        ans=a-b; text=a+' - '+b+' = ?';
      } else if (H) {
        const t=rnd(0,5);
        if(t===0){ a=rnd(500,9999); b=rnd(1,a); ans=a-b; text=a+' - '+b+' = ?'; }
        else if(t===1){ a=rnd(200,9999); b=rnd(1,a); ans=a-b; text=a+' - ? = '+ans; ans=b; }
        else if(t===2){ b=rnd(100,500); ans=rnd(100,500); a=ans+b; text='? - '+b+' = '+ans; }
        else if(t===3){ a=rnd(100,999); b=rnd(10,50); c=rnd(5,30); ans=a-b-c; text=a+' - '+b+' - '+c+' = ?'; }
        else if(t===4){ a=rnd(10,90)*100; b=rnd(1,a/100-1)*100; ans=a-b; text=a+' - '+b+' = ?'; }
        else { b=rnd(100,500); ans=rnd(100,500); a=ans+b; text='¿Cuánto le falta a '+b+' para llegar a '+a+'?'; }
      } else {
        const t=rnd(0,3);
        if(t===0){ a=rnd(20,200); b=rnd(1,a); ans=a-b; text=a+' - '+b+' = ?'; }
        else if(t===1){ a=rnd(20,200); b=rnd(1,a); ans=a-b; text=a+' - ? = '+ans; ans=b; }
        else if(t===2){ a=rnd(2,20)*100; b=rnd(1,a/100-1)*100; ans=a-b; text=a+' - '+b+' = ?'; }
        else { b=rnd(10,100); ans=rnd(10,100); a=ans+b; text='¿Cuánto le falta a '+b+' para llegar a '+a+'?'; }
      }
      break;
    }

    /* ════════════════════════════════
       MULTIPLICACIÓN
       Fácil:   tablas del 1-10, directa a×b=?
       Medio:   tablas 1-15, incógnita un factor, ×10, ×100
       Difícil: tablas 1-25, incógnitas, 3 factores, cuadrados, expresión algebraica
    ════════════════════════════════ */
    case 'multi': {
      if (E) {
        a=rnd(1,10); b=rnd(1,10);
        ans=a*b; text=a+' × '+b+' = ?';
      } else if (H) {
        const t=rnd(0,5);
        if(t===0){ a=rnd(6,25); b=rnd(6,25); ans=a*b; text=a+' × '+b+' = ?'; }
        else if(t===1){ a=rnd(6,25); b=rnd(6,25); ans=a; text='? × '+b+' = '+(a*b); }
        else if(t===2){ a=rnd(6,25); b=rnd(6,25); ans=b; text=a+' × ? = '+(a*b); }
        else if(t===3){ a=rnd(3,12); b=rnd(3,12); c=rnd(2,6); ans=a*b*c; text=a+' × '+b+' × '+c+' = ?'; }
        else if(t===4){ a=rnd(8,15); ans=a*a; text=a+'² = ?'; }
        else { a=rnd(6,20); b=rnd(6,20); ans=a; text='Si '+b+' × x = '+(a*b)+',  x = ?'; }
      } else {
        const t=rnd(0,3);
        if(t===0){ a=rnd(2,15); b=rnd(2,15); ans=a*b; text=a+' × '+b+' = ?'; }
        else if(t===1){ a=rnd(2,15); b=rnd(2,15); ans=b; text=a+' × ? = '+(a*b); }
        else if(t===2){ a=rnd(2,12); ans=a*10; text=a+' × 10 = ?'; }
        else { a=rnd(2,10); ans=a*100; text=a+' × 100 = ?'; }
      }
      break;
    }

    /* ════════════════════════════════
       DIVISIÓN
       Fácil:   a÷b=? exacta, divisores pequeños (tablas 1-10)
       Medio:   divisores hasta 15, incógnita divisor, ÷10, ÷100
       Difícil: divisores hasta 25, incógnita dividendo, expresión verbal, división consecutiva
    ════════════════════════════════ */
    case 'div': {
      if (E) {
        b=rnd(2,10); ans=rnd(2,10); a=b*ans;
        text=a+' ÷ '+b+' = ?';
      } else if (H) {
        const t=rnd(0,4);
        if(t===0){ b=rnd(6,25); ans=rnd(6,25); a=b*ans; text=a+' ÷ '+b+' = ?'; }
        else if(t===1){ b=rnd(6,25); ans=rnd(6,25); a=b*ans; text=a+' ÷ ? = '+ans; ans=b; }
        else if(t===2){ b=rnd(6,25); ans=rnd(6,25); a=b*ans; text='? ÷ '+b+' = '+ans; ans=a; }
        else if(t===3){ b=rnd(2,9); ans=rnd(2,12); a=b*ans; text='¿Cuántas veces cabe '+b+' en '+a+'?'; }
        else { b=rnd(6,20); ans=rnd(6,20); a=b*ans; text='Reparte '+a+' en '+b+' grupos iguales: ?'; }
      } else {
        const t=rnd(0,3);
        if(t===0){ b=rnd(2,15); ans=rnd(2,15); a=b*ans; text=a+' ÷ '+b+' = ?'; }
        else if(t===1){ b=rnd(2,15); ans=rnd(2,15); a=b*ans; text=a+' ÷ ? = '+ans; ans=b; }
        else if(t===2){ ans=rnd(2,10); text=ans*10+' ÷ 10 = ?'; }
        else { ans=rnd(2,10); text=ans*100+' ÷ 100 = ?'; }
      }
      break;
    }

    /* ════════════════════════════════
       POTENCIAS
       Fácil:   base 2-5, solo al cuadrado
       Medio:   base 2-9, cuadrado y cubo, x^0, x^1
       Difícil: base 2-12, exponente variable, comparar potencias
    ════════════════════════════════ */
    case 'potencias': {
      if (E) {
        a=rnd(2,9); ans=a*a; text=a+'² = ?';
      } else if (H) {
        const t=rnd(0,5);
        if(t===0){ a=rnd(2,12); b=rnd(2,4); ans=Math.pow(a,b); text=a+'^'+b+' = ?'; }
        else if(t===1){ b=rnd(2,3); ans=rnd(2,10); text='?^'+b+' = '+Math.pow(ans,b); }
        else if(t===2){ a=rnd(2,10); ans=rnd(2,4); text=a+'^? = '+Math.pow(a,ans); }
        else if(t===3){ a=rnd(2,8); ans=a*a*a; text='Cubo de '+a+' = ?'; }
        else if(t===4){ a=rnd(2,9); ans=1; text=a+'^0 = ?'; }
        else { a=rnd(2,6); b=rnd(2,3); c=rnd(2,6); const dd=rnd(2,3); ans=Math.max(Math.pow(a,b),Math.pow(c,dd)); text='Mayor entre '+a+'^'+b+' y '+c+'^'+dd+' = ?'; }
      } else {
        const t=rnd(0,3);
        if(t===0){ a=rnd(2,9); ans=a*a; text=a+'² = ?'; }
        else if(t===1){ a=rnd(2,6); ans=a*a*a; text=a+'³ = ?'; }
        else if(t===2){ a=rnd(2,9); ans=1; text=a+'^0 = ?'; }
        else { a=rnd(2,9); ans=a; text=a+'^1 = ?'; }
      }
      break;
    }

    /* ════════════════════════════════
       RAÍCES CUADRADAS
       Fácil:   √(a²)=? bases 2-10
       Medio:   √ directa y si √x=a → x=?
       Difícil: suma/resta de raíces, bases hasta 20
    ════════════════════════════════ */
    case 'raices': {
      if (E) {
        a=rnd(2,10); ans=a; text='√'+(a*a)+' = ?';
      } else if (H) {
        const t=rnd(0,3);
        if(t===0){ a=rnd(2,20); ans=a; text='√'+(a*a)+' = ?'; }
        else if(t===1){ a=rnd(2,15); ans=a*a; text='Si √x = '+a+',  x = ?'; }
        else if(t===2){ a=rnd(2,10); b=rnd(2,10); ans=a+b; text='√'+(a*a)+' + √'+(b*b)+' = ?'; }
        else { a=rnd(3,15); b=rnd(2,a-1); ans=a-b; text='√'+(a*a)+' - √'+(b*b)+' = ?'; }
      } else {
        const t=rnd(0,2);
        if(t===0){ a=rnd(2,15); ans=a; text='√'+(a*a)+' = ?'; }
        else if(t===1){ a=rnd(2,12); ans=a*a; text='Si √x = '+a+',  x = ?'; }
        else { a=rnd(2,10); ans=a; text='¿Cuál número al cuadrado da '+(a*a)+'?'; }
      }
      break;
    }

    /* ════════════════════════════════
       FRACCIONES
       Fácil:   suma/resta mismo denominador pequeño
       Medio:   fracción de entero, equivalentes, simplificar
       Difícil: diferente denominador, impropia a mixto, multiplicación
    ════════════════════════════════ */
    case 'fracciones': {
      if (E) {
        const den=rnd(2,8);
        if(rnd(0,1)===0){ const n1=rnd(1,den-1), n2=rnd(1,den-1); ans=n1+n2; text=n1+'/'+den+' + '+n2+'/'+den+' = ?/'+den; }
        else { const n1=rnd(2,den), n2=rnd(1,n1-1); ans=n1-n2; text=n1+'/'+den+' - '+n2+'/'+den+' = ?/'+den; }
      } else if (H) {
        const t=rnd(0,5);
        if(t===0){ const den=rnd(3,12); const n1=rnd(1,den-1), n2=rnd(1,den-1); ans=n1+n2; text=n1+'/'+den+' + '+n2+'/'+den+' = ?/'+den; }
        else if(t===1){ b=rnd(2,8); const den2=b*rnd(2,4); const n1=rnd(1,b-1), n2=rnd(1,den2-1); ans=Math.round((n1/b+n2/den2)*den2); text=n1+'/'+b+' + '+n2+'/'+den2+' = ?/'+den2; }
        else if(t===2){ b=rnd(2,6); a=rnd(1,b-1); const tot=rnd(2,20)*b; ans=tot/b*a; text=a+'/'+b+' de '+tot+' = ?'; }
        else if(t===3){ b=rnd(2,6); c=rnd(1,b-1); a=rnd(2,5)*b+c; ans=Math.floor(a/b); text=a+'/'+b+' = ? enteros y '+c+'/'+b; }
        else if(t===4){ a=rnd(1,6); b=rnd(2,8); c=rnd(2,6); ans=a*c; text=a+'/'+b+' × '+b*c+' = ?'; }
        else { g=rnd(2,5); a=rnd(2,7); b=rnd(2,7); ans=a; text=(a*g)+'/'+(b*g)+' simplificado = ?/'+b; }
      } else {
        const t=rnd(0,2);
        if(t===0){ b=rnd(2,6); a=rnd(1,b-1); const tot=rnd(2,10)*b; ans=tot/b*a; text=a+'/'+b+' de '+tot+' = ?'; }
        else if(t===1){ g=rnd(2,4); a=rnd(1,6); b=rnd(2,8); ans=a; text=(a*g)+'/'+(b*g)+' simplificado = ?/'+b; }
        else { g=rnd(2,5); a=rnd(1,6); b=rnd(2,8); ans=a*g; text=a+'/'+b+' = ?/'+(b*g); }
      }
      break;
    }

    /* ════════════════════════════════
       PORCENTAJES
       Fácil:   % de número con % simples (10%, 25%, 50%)
       Medio:   % de número, hallar el %, descuento
       Difícil: aumento, hallar el total, casos más complejos
    ════════════════════════════════ */
    case 'porcentajes': {
      if (E) {
        const pct=pick([10,25,50]); const tot=rnd(2,20)*10;
        ans=tot*pct/100; text=pct+'% de '+tot+' = ?';
      } else if (H) {
        const pcts=[5,10,15,20,25,30,40,50,60,75,80];
        const pct=pick(pcts); const tot=rnd(5,80)*10;
        const t=rnd(0,4);
        if(t===0){ ans=tot*pct/100; text=pct+'% de '+tot+' = ?'; }
        else if(t===1){ ans=pct; text='¿Qué % de '+tot+' es '+(tot*pct/100)+'?'; }
        else if(t===2){ ans=tot; text=pct+'% de ? = '+(tot*pct/100); }
        else if(t===3){ ans=tot+tot*pct/100; text='Precio $'+tot+' con '+pct+'% de aumento = $?'; }
        else { ans=tot-tot*pct/100; text='Precio $'+tot+' con '+pct+'% de descuento = $?'; }
      } else {
        const pcts=[10,20,25,50]; const pct=pick(pcts); const tot=rnd(2,40)*10;
        const t=rnd(0,2);
        if(t===0){ ans=tot*pct/100; text=pct+'% de '+tot+' = ?'; }
        else if(t===1){ ans=pct; text='¿Qué % de '+tot+' es '+(tot*pct/100)+'?'; }
        else { ans=tot-tot*pct/100; text='Descuento del '+pct+'% sobre $'+tot+' = $?'; }
      }
      break;
    }

    /* ════════════════════════════════
       ÁLGEBRA BÁSICA
       Fácil:   x + b = c  y  x - b = c  (despeje simple)
       Medio:   ax = c, ax + b = c, ax - b = c
       Difícil: a(x+b)=c, 3x, expresiones, función f(x)
    ════════════════════════════════ */
    case 'algebra': {
      const xval = E?rnd(1,10):H?rnd(5,30):rnd(2,20);
      const coef = H?rnd(4,10):rnd(2,5);
      const bval = E?rnd(1,10):H?rnd(5,25):rnd(1,15);
      if (E) {
        if(rnd(0,1)===0){ ans=xval; text='x + '+bval+' = '+(xval+bval)+',  x = ?'; }
        else             { ans=xval; text='x - '+bval+' = '+(xval-bval)+',  x = ?'; }
      } else if (H) {
        const t=rnd(0,5);
        if(t===0){ ans=xval; text=coef+'x = '+(coef*xval)+',  x = ?'; }
        else if(t===1){ ans=xval; text=coef+'x + '+bval+' = '+(coef*xval+bval)+',  x = ?'; }
        else if(t===2){ ans=xval; text=coef+'x - '+bval+' = '+(coef*xval-bval)+',  x = ?'; }
        else if(t===3){ ans=xval; text='3x - '+bval+' = '+(3*xval-bval)+',  x = ?'; }
        else if(t===4){ ans=xval; text=coef+'(x + '+bval+') = '+(coef*(xval+bval))+',  x = ?'; }
        else { ans=xval; text='Si f(x)='+coef+'x+'+bval+' y f(x)='+(coef*xval+bval)+', x=?'; }
      } else {
        const t=rnd(0,2);
        if(t===0){ ans=xval; text=coef+'x = '+(coef*xval)+',  x = ?'; }
        else if(t===1){ ans=xval; text=coef+'x + '+bval+' = '+(coef*xval+bval)+',  x = ?'; }
        else { ans=xval; text='2x + '+bval+' = '+(2*xval+bval)+',  x = ?'; }
      }
      break;
    }

    /* ════════════════════════════════
       ÁLGEBRA INTERMEDIA
       Fácil:   MCD y MCM simples
       Medio:   (a+b)², diferencia de cuadrados
       Difícil: factorización, valor de expresión, suma cuadrados
    ════════════════════════════════ */
    case 'algebra2': {
      if (E) {
        g=rnd(2,6); a=g*rnd(2,5); b=g*rnd(2,5);
        if(rnd(0,1)===0){ ans=g; text='MCD('+a+', '+b+') = ?'; }
        else { g=a*b/gcd(a,b); ans=g; text='MCM('+a+', '+b+') = ?'; }
      } else if (H) {
        const t=rnd(0,5);
        if(t===0){ g=rnd(2,15); a=g*rnd(2,8); b=g*rnd(2,8); ans=g; text='MCD('+a+', '+b+') = ?'; }
        else if(t===1){ a=rnd(2,12); b=rnd(2,12); g=a*b/gcd(a,b); ans=g; text='MCM('+a+', '+b+') = ?'; }
        else if(t===2){ a=rnd(2,9); b=rnd(2,9); ans=2*a*b; text='('+a+'+'+b+')²  →  2ab = ?'; }
        else if(t===3){ a=rnd(2,12); b=rnd(2,a-1); ans=a+b; text='('+a+'²-'+b+'²) ÷ ('+(a-b)+') = ?'; }
        else if(t===4){ a=rnd(2,8); b=rnd(2,8); ans=a*a+b*b; text=a+'² + '+b+'² = ?'; }
        else { a=rnd(2,8); b=rnd(1,5); const xv=rnd(1,6); ans=a*xv+b; text='Si x='+xv+', entonces '+a+'x+'+b+' = ?'; }
      } else {
        const t=rnd(0,2);
        if(t===0){ g=rnd(2,9); a=g*rnd(2,6); b=g*rnd(2,6); ans=g; text='MCD('+a+', '+b+') = ?'; }
        else if(t===1){ a=rnd(2,8); b=rnd(2,8); g=a*b/gcd(a,b); ans=g; text='MCM('+a+', '+b+') = ?'; }
        else { a=rnd(2,9); b=rnd(2,9); ans=2*a*b; text='('+a+'+'+b+')²  →  2ab = ?'; }
      }
      break;
    }

    /* ════════════════════════════════
       ECUACIONES 2° GRADO
       Fácil:   x²=k (raíz entera), (x+a)(x+b)=0
       Medio:   suma/producto de raíces, discriminante
       Difícil: encontrar raíz, ax²-b=c, todo lo anterior
    ════════════════════════════════ */
    case 'ecuaciones': {
      const r1=rnd(H?-8:-5, H?8:5), r2=rnd(H?-8:-5, H?8:5);
      const B=-(r1+r2), C=r1*r2;
      const sgB=B>=0?'+':'', sgC=C>=0?'+':'';
      if (E) {
        if(rnd(0,1)===0){ a=rnd(2,9); ans=a; text='x² = '+(a*a)+',  x positivo = ?'; }
        else { a=rnd(1,8); b=rnd(1,8); ans=-a; text='(x+'+a+')(x+'+b+')=0  → una solución x=?'; }
      } else if (H) {
        const t=rnd(0,4);
        if(t===0){ ans=r1; text='x²'+sgB+B+'x'+sgC+C+'=0  (una raíz es '+r2+')  x=?'; }
        else if(t===1){ ans=r1+r2; text='x²'+sgB+B+'x'+sgC+C+'=0  → suma de raíces = ?'; }
        else if(t===2){ ans=r1*r2; text='x²'+sgB+B+'x'+sgC+C+'=0  → producto de raíces = ?'; }
        else if(t===3){ ans=B*B-4*C; text='x²'+sgB+B+'x'+sgC+C+'=0  → discriminante b²-4ac = ?'; }
        else { a=rnd(2,8); b=rnd(1,20); ans=rnd(2,8); const lhs=ans*ans*a-b; text=a+'x² - '+b+' = '+lhs+',  x positivo = ?'; }
      } else {
        const t=rnd(0,2);
        if(t===0){ a=rnd(2,9); ans=a; text='x² = '+(a*a)+',  x positivo = ?'; }
        else if(t===1){ ans=r1+r2; text='x²'+sgB+B+'x'+sgC+C+'=0  → suma de raíces = ?'; }
        else { ans=r1*r2; text='x²'+sgB+B+'x'+sgC+C+'=0  → producto de raíces = ?'; }
      }
      break;
    }

    /* ════════════════════════════════
       TRIGONOMETRÍA — sin cambios por dificultad ya bien definida
    ════════════════════════════════ */
    case 'trigono': {
      const angleSet = E?[0,30,90]:H?[0,30,45,60,90]:[0,30,45,60,90];
      const deg = pick(angleSet);
      const sinV={0:'0',30:'1/2',45:'√2/2',60:'√3/2',90:'1'};
      const cosV={0:'1',30:'√3/2',45:'√2/2',60:'1/2',90:'0'};
      const tanV={0:'0',30:'√3/3',45:'1',60:'√3',90:'∞'};
      const t = rnd(0, E?1:H?4:3);
      if(t===0){ ans=sinV[deg]; text='sen('+deg+'°) = ?'; }
      else if(t===1){ ans=cosV[deg]; text='cos('+deg+'°) = ?'; }
      else if(t===2){ ans=tanV[deg]; text='tan('+deg+'°) = ?'; }
      else if(t===3){ const d2=pick([30,45,60]); ans=1; text='sen²('+d2+'°) + cos²('+d2+'°) = ?'; }
      else { const d2=pick([30,60]); const comp=90-d2; ans=comp; text='cos('+d2+'°) = sen(?°)  → ? = ?'; }
      return { text, answer: String(ans), textAnswer: true };
    }

    /* ════════════════════════════════
       LOGARITMOS — sin cambios
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
      else if(t===5){ const e1=rnd(1,4), e2=rnd(1,4); ans=e1+e2; text='log_'+base+'('+Math.pow(base,e1)+') + log_'+base+'('+Math.pow(base,e2)+') = ?'; }
      else if(t===6){ const e1=rnd(2,6), e2=rnd(1,e1-1); ans=e1-e2; text='log_'+base+'('+Math.pow(base,e1)+') - log_'+base+'('+Math.pow(base,e2)+') = ?'; }
      else { const e1=rnd(1,4), e2=rnd(2,4); ans=e1*e2; text=e2+' × log_'+base+'('+Math.pow(base,e1)+') = ?'; }
      break;
    }

    default:
      a=rnd(1,10); b=rnd(1,10); ans=a+b; text=a+' + '+b+' = ?';
  }
  return { text, answer: Math.round(Number(ans)) };
}

// Helper MCD (máximo común divisor)
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

function genQ() {
  // Usa los temas que el profesor eligió, la dificultad controla la complejidad
  const topic = pick(gameTopics);
  return genByTopic(topic, gameDifficulty);
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
  // ── Endpoint para UptimeRobot — responde rápido sin leer archivos ──
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }
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
        if (msg.role === 'screen') {
          // Si el juego estaba en curso al reconectar el screen, reanudar
          if (gameStarted && !G.over) {
            sendState(ws);
            if (!gamePaused && !timerInterval) startTimer();
          } else if (!gameStarted) {
            sendTo(ws, { type: 'waiting' });
          } else {
            sendState(ws);
          }
        } else {
          if (!gameStarted) {
            sendTo(ws, { type: 'waiting' });
          } else {
            sendState(ws);
            if (gamePaused) sendTo(ws, { type: 'pause', paused: true });
          }
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
      // Solo notificar si era un jugador real (no la pantalla)
      if (info.type === 'blue' || info.type === 'red') {
        broadcastAll({ type: 'playerLeft', role: info.type });
      }
      // Si el profesor (pantalla) se desconecta, esperar 8s antes de reiniciar
      // por si es un blip de red o recarga de página
      if (info.type === 'screen') {
        // Pausar el timer durante el grace period sin alterar el estado
        const savedTimer = timerInterval;
        clearInterval(timerInterval);
        timerInterval = null;
        const disconnectTime = Date.now();
        console.log('[*] Profesor desconectado — esperando reconexión (8s)...');
        setTimeout(() => {
          // Si ya hay un screen nuevo conectado, no hacer nada
          let screenBack = false;
          for (const [, c] of clients) {
            if (c.type === 'screen') { screenBack = true; break; }
          }
          if (!screenBack) {
            G = freshState();
            gameStarted = false;
            gamePaused = false;
            broadcastAll({ type: 'hostLeft' });
            console.log('[*] Profesor no reconectó — juego reiniciado');
          } else {
            console.log('[*] Profesor reconectó — juego continúa');
          }
        }, 8000);
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
