# Sistema ATM TecBank201D

Simulador de cajero automático bancario con estética y reglas operativas de un ATM real. Incluye autenticación con tarjeta y sin tarjeta (QR móvil + PIN), manejo físico de efectivo por casetes, avances de crédito y comprobantes auditables.

## Ejecutar

```bash
npm start
```

Abrir `http://localhost:4173`.

## Desplegar en Vercel

Importa el repositorio de GitHub en Vercel desde la raíz del proyecto. La configuración de [vercel.json](./vercel.json) ejecuta `npm run build` y publica `dist/`, que contiene únicamente la aplicación y sus archivos estáticos. No hace falta configurar un `requirements.txt`: este proyecto usa JavaScript y no depende de Python.

El servidor `server.mjs` es solo para desarrollo local; Vercel sirve la aplicación como sitio estático.

Pruebas del dominio:

```bash
npm test
```

## Credenciales de demostración

| Medio | Número | PIN | Detalle |
| --- | --- | --- | --- |
| Tarjeta débito | 4512 •••• •••• 8834 | `1234` | Cuenta de ahorros con saldo inicial de $3.500.000 |
| Tarjeta crédito | 5214 •••• •••• 2017 | `4321` | Cupo disponible inicial de $2.000.000 |
| Sin tarjeta | QR generado en el móvil | `1234` | Usa la cuenta débito asociada |

## Cómo operar

1. Arrastra una tarjeta del panel **Billetera** a la ranura del cajero, o pulsa **Insertar**.
2. Ingresa el PIN con el teclado físico del ATM o el teclado del computador.
3. Elige la operación en el menú.
4. Para operar sin tarjeta, pulsa **Generar QR** en el móvil y arrastra el móvil al lector QR (o pulsa **Escanear en el ATM**).
5. Al finalizar una transacción puedes imprimir el recibo (se abre el diálogo de impresión del navegador).

Los objetos también aceptan un flujo de respaldo por botones. Un destino inválido produce una advertencia visual.

## Escena 3D y capas principales

La interfaz combina un escenario visual y un dashboard operativo:

- **Escenario (`.scene-column`)**
  - `.atm-stage`: contenedor con perspectiva, iluminación y sombra de piso.
  - `.atm-world`: composición híbrida ATM + billetera.
  - `.atm-shell-3d` / `.atm-machine`: volumen del gabinete, biseles y contrarrotación de pantalla.
  - `.sequence-layer`: capa dedicada a secuencias (tarjeta, billetes, recibo).
- **Dashboard (`.dashboard-column`)**
  - credenciales demo, casetes por denominación y auditoría.

Esto permite ubicar rápidamente qué clases gobiernan escena, máquina, objetos y secuencias sin recorrer todo `styles.css`.

## Coreografías visuales

El coordinador `src/ui/choreography.js` sincroniza animaciones sin alterar resultados de dominio:

- **Inserción/devolución de tarjeta**: ~320 ms / ~260 ms.
- **Dispensación de efectivo**: compuerta + salida de billetes, ~1000 ms (máx. 8 billetes visibles + resumen).
- **Depósito**: billetes descendiendo al ATM, ~760 ms.
- **Impresión de recibo**: alimentación + líneas de impresión, ~1550 ms.

Durante una secuencia se bloquean acciones para evitar doble operación, se pausa el timeout de sesión y cualquier clic/tecla (excepto Tab) puede omitir la animación.

### Movimiento reducido

Si el sistema reporta `prefers-reduced-motion: reduce`, las secuencias se acortan (≈140 ms por fase) y se reduce/omite la inercia visual, manteniendo el mismo resultado transaccional.

## Audio sintetizado (Web Audio)

- Sonidos implementados sin archivos externos: clic, servo mecánico y motor de impresora.
- **Estado inicial: apagado**.
- Control en topbar: **Audio ON/OFF**.
- Preferencia persistida en sesión del navegador.
- Si Web Audio o `sessionStorage` no están disponibles/bloqueados, la operación continúa en silencio sin romper el flujo.

## Responsive, accesibilidad y rendimiento

- Breakpoints principales: escritorio (escena + dashboard), tablet y móvil (escenario simplificado en una sola columna).
- Hay alternativas sin drag (botones y teclado) para operar todo el flujo.
- El drag usa pointer events con snap magnético y retorno con resorte ante drops inválidos.
- Para rendimiento visual:
  - se limita la representación animada de efectivo a 8 billetes visibles,
  - las secuencias animan principalmente `transform`/`opacity`,
  - `will-change` se limpia al finalizar cada arrastre.

## Reglas implementadas

### Retiro con tarjeta débito o QR

- Límite diario: **$2.000.000**.
- Monto mínimo: **$10.000**.
- Montos múltiplos de **$10.000**.
- Debe existir saldo y una combinación válida de billetes disponibles.
- Si el ATM no puede armar el monto, la operación se rechaza aunque haya saldo.

### Depósito en efectivo

- Denominaciones aceptadas: **$10.000, $20.000, $50.000 y $100.000**.
- Tope diario: **$5.000.000**.
- Solo para sesiones de débito o QR; la tarjeta de crédito no permite depósitos.
- El inventario de casetes aumenta con los billetes recibidos.

### Avance con tarjeta de crédito

- Única operación disponible con crédito: **avance de efectivo**.
- Comisión: **$8.000 fijos + 4% del monto**.
- Interés: **2,3% M.V.** causado desde el día del avance, sin período de gracia.
- Monto mínimo: **$20.000**.
- Tope diario: **$1.000.000**.
- El cupo disponible se reduce por el monto del avance más la comisión.

### Efectivo físico

- Casetes por denominación: $100.000, $50.000, $20.000 y $10.000.
- El retiro y el avance descuentan billetes; el depósito los incrementa.
- La composición del monto prioriza la menor cantidad de billetes posible.

### Autenticación y seguridad

- Máximo **3 intentos** de PIN; al tercero la tarjeta se bloquea.
- El QR expira a los **45 segundos** y es de un solo uso.
- La sesión se cierra automáticamente tras **120 segundos** de inactividad.
- Toda autenticación, transacción, rechazo, movimiento de efectivo e impresión queda en la auditoría.

### Recibos

Incluyen ATM, número de recibo, fecha, identificador de operación, tipo, canal, cliente, cuenta/tarjeta enmascaradas, estado, monto, comisiones, interés, saldo/cupo posterior, billetes y motivo de rechazo cuando aplica.

## Arquitectura

```
src/
  domain/
    atm-service.js      Orquestador de sesión, operaciones y auditoría
    state-machine.js    Estados y transiciones del ATM
    inventory.js        Casetes, composición y actualización de billetes
    authentication      Implementada en atm-service + qr.js
    qr.js               Tokens QR temporales de un solo uso
    credit.js           Comisión e interés de avances
    receipts.js         Construcción del comprobante
    seed.js             Cliente, cuentas, tarjetas e inventario inicial
    money.js            Denominaciones y formato COP
  ui/
    app.js              Interfaz, drag & drop, teclado y flujos
    qr-canvas.js        Representación visual del QR
  styles.css            Diseño del ATM, billetera, móvil y recibo
tests/                  Pruebas de dominio con node:test
```

La aplicación no usa dependencias externas: el servidor estático usa Node y el dominio se prueba con `node:test`.

## Alcance

Es una simulación educativa. No se conecta a redes bancarias reales, no procesa dinero real y no sustituye controles antifraude de producción.
