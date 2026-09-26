import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Turns a YouTube or Vimeo address into the embed address the site allows, or null for anything else. The server
 * enforces the same allowlist when it saves (ContentSanitizer), so this only saves an editor a wasted save.
 */
export function toEmbedUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const id = (value: string | null | undefined, pattern: RegExp) => (value && pattern.test(value) ? value : null);

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.searchParams.get('v');
    const clean = id(v, /^[\w-]{6,20}$/);
    return clean ? `https://www.youtube-nocookie.com/embed/${clean}` : null;
  }
  if (host === 'youtu.be') {
    const clean = id(url.pathname.slice(1), /^[\w-]{6,20}$/);
    return clean ? `https://www.youtube-nocookie.com/embed/${clean}` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const clean = id(url.pathname.split('/').filter(Boolean).pop(), /^\d{4,12}$/);
    return clean ? `https://player.vimeo.com/video/${clean}` : null;
  }
  return null;
}

/** A video block: an iframe whose address the editor cannot set to anything but an approved embed. */
export const VideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return { src: { default: null } };
  },

  parseHTML() {
    // Frames pasted in from elsewhere only survive if they point at an approved embed.
    return [{ tag: 'iframe[src]', getAttrs: (el) => (toEmbedUrl((el as HTMLElement).getAttribute('src') ?? '') ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['iframe', mergeAttributes(HTMLAttributes, { allowfullscreen: 'true', loading: 'lazy' })];
  },

  // Markdown has no form for a video, so it is kept as a line of HTML (read back in by parseHTML above).
  renderMarkdown: (node) => `<iframe src="${node.attrs?.['src'] ?? ''}"></iframe>`,
});
