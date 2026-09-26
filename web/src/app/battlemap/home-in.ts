import type { Map } from 'maplibre-gl';

/** How long the reticule takes to close in on the incident and fade into its ring (see `.home-in` in _map.scss). */
export const HOME_IN_MS = 1600;

/** A gunsight: a ring, ticks on its four sides, and a dot at the centre. Strokes keep their width however large it is drawn. */
const RETICULE = `
  <svg viewBox="0 0 48 48" focusable="false">
    <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke">
      <circle cx="24" cy="24" r="13" vector-effect="non-scaling-stroke" />
      <path d="M24 2v9M24 37v9M2 24h9M37 24h9" vector-effect="non-scaling-stroke" />
    </g>
    <circle cx="24" cy="24" r="1.6" fill="currentColor" />
  </svg>`;

/**
 * Draws attention to the incident a link opened onto: a reticule, wide across the map at first, closes in on the incident's
 * marker and fades into its ring. It keeps to the incident as the map moves, lets clicks through, and takes itself away when done
 * (or at once, with the function returned). Nothing is drawn for those who ask for less motion.
 */
export function homeIn(map: Map, lon: number, lat: number): () => void {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => undefined;
  }
  const el = document.createElement('div');
  el.className = 'home-in';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = RETICULE;
  const place = () => {
    const at = map.project([lon, lat]);
    el.style.transform = `translate(${at.x}px, ${at.y}px)`;
  };
  place();
  map.getContainer().appendChild(el);
  map.on('move', place);

  let gone = false;
  const done = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    map.off('move', place);
    el.remove();
  };
  // The animation's end takes it away; the timer only in case the browser never says it ended (a hidden tab, say).
  el.addEventListener('animationend', done);
  const timer = setTimeout(done, HOME_IN_MS + 1000);
  return done;
}
