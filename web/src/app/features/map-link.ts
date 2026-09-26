/**
 * A Battle Map link from a feature page opens with the community photos layer off: over the contacts a feature points to, the
 * pictures are clutter. A link to a picture keeps them, the picture being the point. (The Battle Map reads `photos=0`.)
 */
export function featureMapLink(url: string): string {
  if (!url.startsWith('/battlemap') || /[?&](photos|picture)=/.test(url)) return url;
  const [path, fragment] = url.split('#');
  return `${path}${path.includes('?') ? '&' : '?'}photos=0${fragment === undefined ? '' : `#${fragment}`}`;
}

