# Sembrado

Estrategia por casillas para dos jugadores, con espíritu de Risk y del ajedrez. Los dos jugadores ordenan **a la vez y en secreto**; después se revela todo y se resuelve. PWA instalable, PvP directo entre móviles por WebRTC y partida contra el bot sin conexión.

**Versión:** 0.0.1 (nombre provisional)

## Reglas

**Tablero:** 8x8 con rocas colocadas en simetría, para que ningún lado tenga ventaja. Cada jugador empieza con su capital en una esquina y dos peones. Cada uno ve su capital abajo a la izquierda (a1), como en el ajedrez.

**Ronda:** tienes 3 acciones. Cada acción coloca una unidad o levanta un edificio. Nadie ve tu jugada hasta que los dos confirmáis.

**Unidades:** el color indica el tipo y el símbolo de ajedrez permite distinguirlas sin color.

| Unidad | Fuerza | Vence a | Especial |
|---|---|---|---|
| ♟ Peón | 1 | — | Barato. Expande y paga edificios |
| ♜ Infantería | 2 | Caballería | +1 al defender |
| ♞ Caballería | 2 | Arqueros | Llega a dos casillas de distancia |
| ♝ Arqueros | 2 | Infantería | +1 al atacar |

La ventaja del triángulo suma +2: es una bonificación, no una victoria automática (idea tomada de Fire Emblem).

**Dónde colocar:** en tus casillas (cambia la guarnición y la anterior vuelve a tu reserva) o en las vecinas.

**Combate:**
- Atacante: base, ventaja, arqueros y flanqueo (+1 por cada casilla tuya vecina al objetivo a partir de la segunda, máximo +2).
- Defensor: base, ventaja, infantería, muralla (+2), capital (+2) y apoyo (+1 por cada casilla propia vecina a partir de la segunda, máximo +2). Idea tomada del "support" de Diplomacy.
- **El defensor gana los empates**, como en Risk.
- Si los dos jugadores envían unidades distintas a una casilla libre, gana la más fuerte. Si tienen la misma fuerza, chocan y la casilla sigue libre (el "bounce" de Diplomacy).

**Casilla negra:** si los dos enviáis la **misma unidad** a la misma casilla en la misma ronda, se quema y nadie podrá ocuparla nunca. Las capitales no se queman: en ese caso, el defensor la conserva.

**Suministro:** al final de cada ronda, las casillas que no estén unidas a tu capital por casillas tuyas se pierden y vuelven a ser libres. Cortar un pasillo estrecho puede hundir una región entera, y las casillas negras sirven para cerrar pasos.

**Edificios** (en casillas tuyas, no en la capital, pagados con peones):

| Edificio | Coste | Efecto |
|---|---|---|
| ❋ Granja | 2 | +1 peón cada ronda |
| ⚑ Cuartel | 3 | +1 unidad del tipo que guarnece la casilla cada ronda |
| ▦ Muralla | 3 | +2 a la defensa de la casilla |

Si pierdes la casilla, pierdes el edificio.

**Refuerzos por ronda:** 1 peón por cada 3 casillas (mínimo 3), 1 soldado por cada 5 casillas, 1 soldado de la capital (rota entre infantería, caballería y arqueros), la producción de los edificios y 1 soldado de botín si has capturado terreno rival.

**Victoria:**
- Tomar la capital rival.
- Controlar el 65% de las casillas jugables.
- O tener más puntos al terminar la ronda 20 (1 por casilla y 2 por edificio). Desempate: casillas y después soldados.

## Interfaz

- Mobile-first y táctil: botones de 44 px o más, controles en la zona del pulgar, vibración al colocar y en las casillas negras.
- Tus casillas son claras (marfil) y las del rival, oscuras (grafito). El color se reserva para el tipo de unidad.
- La lista de órdenes muestra el resultado previsto de cada ataque ("5 contra 2: la tomas si no cambia su guarnición").
- Al tocar una casilla ocupada ves la cuenta exacta de ataque y defensa contra cada unidad.
- Revelado animado casilla a casilla e informe de ronda con cada choque, captura, corte o casilla negra.
- Respeta "reducir movimiento" del sistema.

## PvP por WebRTC

1. Un jugador pulsa **Crear sala** y comparte el código de cinco caracteres o el enlace.
2. El otro pulsa **Unirse** y escribe el código, o abre el enlace.
3. La conexión es directa entre los dos móviles (PeerJS sobre WebRTC). No hay servidor que decida nada: los dos ejecutan el mismo motor determinista.

**Juego limpio sin servidor:**
- **Semilla compartida:** cada jugador se compromete con una mitad aleatoria (hash) y luego la revela. Ninguno puede elegir el tablero.
- **Compromiso y revelado en cada ronda:** primero se envía el hash de la jugada con un valor aleatorio, y solo cuando los dos han confirmado se revelan. Nadie puede cambiar su jugada después de ver la del rival.
- **Validación:** cada jugada revelada se comprueba contra las reglas.
- **Estado verificado:** tras cada ronda, los dos comparan el hash del tablero. Si no coincide, la partida se detiene.
- **Reconexión:** si el invitado pierde la conexión, reintenta cada 3 segundos. Al volver, el anfitrión le envía el historial y el invitado reconstruye y verifica la partida.
- **Tiempo:** 60 segundos por ronda. Al agotarse se envía lo que tuvieras planeado.

## Ejecutar

**Lo más rápido:** descomprime y abre `index.html` con doble clic. Funciona la partida contra el bot y se guarda en el navegador.

Para PvP, instalar la app y usarla sin conexión hace falta servirla por HTTP o HTTPS:

```bash
npm start          # sirve en http://localhost:8080
npm test           # 25 tests: motor y protocolo PvP
npm run sim        # simulador de balance (bots)
```

**Si cambias el código de `src/`**, regenera el script que carga la página:

```bash
npm install        # solo la primera vez (instala esbuild)
npm run build      # genera app.bundle.js
```

`index.html` carga `app.bundle.js`, un único script normal. Se hace así porque los navegadores bloquean los módulos de JavaScript cuando el HTML se abre con doble clic (`file://`).

Para PvP entre móviles hay que publicarlo en HTTPS (por ejemplo, Vercel: basta con subir la carpeta, no tiene build). El service worker y la instalación como app también necesitan HTTPS.

**Probar el PvP en un solo ordenador sin internet:** abre `http://localhost:8080/?dev=bc` en dos pestañas, crea la sala en una y únete en la otra. Usa BroadcastChannel en lugar de WebRTC, con el mismo protocolo.

## Verificado en esta versión

- 25 tests unitarios: reglas, casillas negras, suministro, edificios, victoria, repetición desde el historial, sincronización PvP, detección de trampas (jugada cambiada tras confirmar, jugada ilegal), rendición y reconexión.
- PvP de extremo a extremo en navegador con dos páginas (BroadcastChannel): 8 rondas sin ningún desajuste de estado.
- Pantallas de 390x844 y 375x667 sin desbordamiento.
- Funcionamiento sin conexión con el service worker.

## Balance (simulado, `npm run sim`)

| Emparejamiento | Resultado |
|---|---|
| Normal contra Normal | Equilibrado (101 frente a 98 en 200 partidas) |
| Normal contra Fácil | Normal gana el 100% |
| Fácil contra Azar | Fácil gana el 100% |

Lo aprendido al ajustar:
- Sin apoyo defensivo ni suministro, las casillas cambiaban de dueño sin fin y casi todo acababa en empate.
- El bot que siempre elige la jugada "óptima" pierde contra uno más variado: con órdenes simultáneas, ser predecible se castiga.

## Limitaciones conocidas

- **WebRTC real sin probar aquí:** el entorno de desarrollo no tiene acceso a internet, así que la conexión PeerJS no se ha probado entre dos móviles. El protocolo sí está probado de extremo a extremo con otro transporte. Es lo primero que hay que comprobar al publicarlo.
- **Redes estrictas:** solo se usa STUN. Algunas redes móviles o corporativas necesitan un servidor TURN; se puede configurar con `window.SEMBRADO_ICE`.
- **Emparejamiento:** usa el servidor público gratuito de PeerJS, sin garantías de disponibilidad.
- **Bots simétricos:** entre bots iguales casi todas las partidas llegan a la ronda 20 y se deciden por puntos. Con humanos debería haber más variedad, pero hay que comprobarlo jugando.
- **Defender rinde menos que atacar** según la simulación. Es el siguiente punto de balance.
- **Reconexión antes de empezar** la partida no está cubierta; solo durante la partida.
- **Ligera ventaja del lado B** en algunas tandas de simulación (55% frente a 45%), dentro del margen del ruido. Conviene vigilarla.

## Estructura

```
index.html               Pantallas
manifest.webmanifest     PWA
sw.js                    Service worker (sin conexión)
icons/                   Iconos de la app
src/engine/rules.js      Unidades, edificios y números del juego
src/engine/game.js       Motor determinista: validación, combate, suministro, victoria
src/engine/bot.js        Bot (normal y fácil)
src/engine/sha256.js     SHA-256 síncrono (funciona también sin HTTPS)
src/engine/rng.js        Aleatoriedad con semilla
src/net/session.js       Protocolo PvP: semilla, compromiso y revelado, verificación
src/net/transports.js    PeerJS (WebRTC), BroadcastChannel y transporte en memoria
src/ui/app.js            Interfaz
src/ui/styles.css        Estilos
tests/                   Tests
tools/simulate.mjs       Simulador de balance
```

## Changelog

### 0.0.1 (corrección)
- El juego funciona al abrir `index.html` con doble clic: todo el código va en `app.bundle.js`. Antes, los botones no respondían fuera de un servidor.

### 0.0.1
- Primera versión jugable: tablero 8x8, cuatro unidades con triángulo de ventaja, casillas negras, suministro, tres edificios, refuerzos estilo Risk y tres formas de ganar.
- Bot en dos niveles y partida guardada en el dispositivo.
- PvP por WebRTC con compromiso y revelado, verificación del estado por ronda y reconexión.
- PWA instalable con funcionamiento sin conexión.
