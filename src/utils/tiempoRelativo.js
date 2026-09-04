/**
 * Cuánto hace que pasó algo, en la forma más corta que se entienda.
 *
 * Para la columna derecha de «Actividad reciente», que son once píxeles al
 * lado de un título que sí importa: «hace 3 horas» ahí compite con el
 * contenido, «3 h» no.
 *
 * NO REEMPLAZA A `formatNotifTime` de `NotificationsScreen`, que resuelve
 * otro problema: esa pantalla es una lista larga donde la hora exacta del
 * aviso («hoy 14:32») ayuda a ubicarse. Acá son tres filas de resumen.
 */

const MIN = 60000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const SEMANA = 7 * DIA;

/**
 * `'ahora'`, `'N min'`, `'N h'`, `'N d'` o `'N sem'`. `null` si la fecha no
 * se puede leer, y entonces la fila se dibuja sin etiqueta: mejor eso que un
 * «NaN min».
 *
 * Una fecha futura devuelve `'ahora'`. El reloj del servidor y el del
 * teléfono no siempre coinciden, y «hace -3 min» es peor que «ahora».
 */
export function haceCuanto(iso, ahora = new Date()) {
  // `new Date(null)` es la época y `Number.isFinite` la da por buena, así
  // que un valor ausente daría «2952 sem» en vez de nada.
  if (typeof iso !== 'string' && !(iso instanceof Date)) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;

  const transcurrido = ahora.getTime() - t;
  if (transcurrido < MIN) return 'ahora';
  if (transcurrido < HORA) return `${Math.floor(transcurrido / MIN)} min`;
  if (transcurrido < DIA) return `${Math.floor(transcurrido / HORA)} h`;
  if (transcurrido < SEMANA) return `${Math.floor(transcurrido / DIA)} d`;
  return `${Math.floor(transcurrido / SEMANA)} sem`;
}
