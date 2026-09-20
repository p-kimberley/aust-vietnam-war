import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { RichText } from './rich-text';
import { toEmbedUrl } from './video-embed';

async function mount(html: string, disabled = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture: ComponentFixture<RichText> = TestBed.createComponent(RichText);
  fixture.componentRef.setInput('html', html);
  fixture.componentRef.setInput('disabled', disabled);
  const emitted: string[] = [];
  fixture.componentInstance.changed.subscribe((h) => emitted.push(h));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, emitted, editor: () => el.querySelector('.tiptap') as HTMLElement };
}

const button = (el: HTMLElement, title: string) => el.querySelector<HTMLButtonElement>(`.rt__bar button[title^="${title}"]`)!;

describe('toEmbedUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://player.vimeo.com/video/76979871?h=abc', 'https://player.vimeo.com/video/76979871'],
    ['  https://youtu.be/dQw4w9WgXcQ  ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
  ])('turns %s into an approved embed', (input, expected) => expect(toEmbedUrl(input)).toBe(expected));

  it.each([
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v="><script>alert(1)</script>',
    'https://www.youtube.com/',
    'https://vimeo.com/channels/staffpicks',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('refuses %s', (input) => expect(toEmbedUrl(input)).toBeNull());
});

describe('RichText', () => {
  it('shows the given content and a labelled toolbar', async () => {
    const { el, editor } = await mount('<h2>Heading</h2><p>Some <strong>bold</strong> text.</p>');

    expect(el.querySelector('[role=toolbar]')?.getAttribute('aria-label')).toBe('Formatting');
    expect(editor().querySelector('h2')?.textContent).toBe('Heading');
    expect(editor().querySelector('strong')?.textContent).toBe('bold');
  });

  it('reports a change when a toolbar command edits the text, and reports empty text as empty', async () => {
    const { el, emitted, fixture } = await mount('<p>Hello</p>');

    const editor = (fixture.componentInstance as unknown as { editor: () => import('@tiptap/core').Editor }).editor();
    editor.commands.selectAll();
    button(el, 'Bold').click();

    expect(emitted.at(-1)).toBe('<p><strong>Hello</strong></p>');

    editor.commands.clearContent(true);
    expect(emitted.at(-1)).toBe('');
  });

  it('replaces the text when the host gives it new content, without reporting that as a change', async () => {
    const { fixture, editor, emitted } = await mount('<p>One</p>');

    fixture.componentRef.setInput('html', '<p>Two</p>');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor().textContent).toBe('Two');
    expect(emitted).toEqual([]);
  });

  it('cannot be edited when disabled', async () => {
    const { editor } = await mount('<p>Locked</p>', true);

    expect(editor().getAttribute('contenteditable')).toBe('false');
  });

  it('only accepts links with a safe address and only embeds approved videos', async () => {
    const { el, fixture, editor } = await mount('<p>Text</p>');
    const ed = (fixture.componentInstance as unknown as { editor: () => import('@tiptap/core').Editor }).editor();
    const submit = async (which: string, value: string) => {
      button(el, which).click();
      fixture.detectChanges();
      const input = el.querySelector<HTMLInputElement>('.rt__prompt input')!;
      input.value = value;
      el.querySelector<HTMLFormElement>('.rt__prompt')!.dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.detectChanges();
    };

    ed.commands.selectAll();
    await submit('Link', 'javascript:alert(1)');
    expect(el.querySelector('.rt__error')?.textContent).toContain('Use an address');
    expect(editor().querySelector('a')).toBeNull();

    await submit('Link', 'https://example.com/page');
    expect(editor().querySelector('a')?.getAttribute('href')).toBe('https://example.com/page');

    await submit('Embed a YouTube', 'https://evil.example/v.mp4');
    expect(el.querySelector('.rt__error')?.textContent).toContain('Only YouTube and Vimeo');
    expect(editor().querySelector('iframe')).toBeNull();

    await submit('Embed a YouTube', 'https://youtu.be/dQw4w9WgXcQ');
    expect(editor().querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('drops frames pasted or loaded from anywhere but the approved hosts', async () => {
    const { editor } = await mount('<p>Text</p><iframe src="https://evil.example/x"></iframe><iframe src="https://player.vimeo.com/video/76979871"></iframe>');

    const srcs = [...editor().querySelectorAll('iframe')].map((f) => f.getAttribute('src'));
    expect(srcs).toEqual(['https://player.vimeo.com/video/76979871']);
  });

  it('inserts a picture from the library at the cursor', async () => {
    const { fixture, editor } = await mount('<p>Text</p>');

    fixture.componentInstance.insertImage('/media/aa/abc.jpg', 'A patrol');

    const img = editor().querySelector('img');
    expect([img?.getAttribute('src'), img?.getAttribute('alt')]).toEqual(['/media/aa/abc.jpg', 'A patrol']);
  });

  it('asks its host to open the picture library', async () => {
    const { fixture, el } = await mount('<p>Text</p>');
    let asked = 0;
    fixture.componentInstance.pickImage.subscribe(() => asked++);

    button(el, 'Insert a picture').click();

    expect(asked).toBe(1);
  });
});
