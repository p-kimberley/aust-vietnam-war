import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORED_FLAG_PREFIX } from '../battlemap/stored-flag';
import { RichText } from './rich-text';
import { toEmbedUrl } from './video-embed';

async function mount(markdown: string, disabled = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture: ComponentFixture<RichText> = TestBed.createComponent(RichText);
  fixture.componentRef.setInput('markdown', markdown);
  fixture.componentRef.setInput('disabled', disabled);
  const emitted: string[] = [];
  fixture.componentInstance.changed.subscribe((h) => emitted.push(h));
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const ed = () => (fixture.componentInstance as unknown as { editor: () => import('@tiptap/core').Editor }).editor();
  const source = () => el.querySelector<HTMLTextAreaElement>('.rt__md');
  const mode = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.rt__modes button')].find((b) => b.textContent?.trim() === label)!;
  return { fixture, el, emitted, settle, ed, source, mode, editor: () => el.querySelector('.tiptap') as HTMLElement };
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
  beforeEach(() => localStorage.clear());

  it('shows the Markdown it is given, formatted, with a labelled toolbar, editing visually to begin with', async () => {
    const { el, editor, mode } = await mount('## Heading\n\nSome **bold** text.');

    expect(el.querySelector('[role=toolbar]')?.getAttribute('aria-label')).toBe('Formatting');
    expect(editor().querySelector('h2')?.textContent).toBe('Heading');
    expect(editor().querySelector('strong')?.textContent).toBe('bold');
    expect(mode('Visual').getAttribute('aria-pressed')).toBe('true');
  });

  it('reports a change as Markdown when a toolbar command edits the text, and empty text as empty', async () => {
    const { el, emitted, ed } = await mount('Hello');

    ed().commands.selectAll();
    button(el, 'Bold').click();

    expect(emitted.at(-1)).toBe('**Hello**');

    ed().commands.clearContent(true);
    expect(emitted.at(-1)).toBe('');
  });

  it('has no underline (Markdown has none), but has strikethrough', async () => {
    const { el } = await mount('Text');

    expect(button(el, 'Underline')).toBeNull();
    expect(button(el, 'Strikethrough')).not.toBeNull();
  });

  it('replaces the text when the host gives it new Markdown, without reporting that as a change', async () => {
    const { fixture, editor, emitted, settle } = await mount('One');

    fixture.componentRef.setInput('markdown', 'Two');
    await settle();

    expect(editor().textContent).toBe('Two');
    expect(emitted).toEqual([]);
  });

  it('switches to the Markdown itself and back, the same text either way, and remembers the choice', async () => {
    const { fixture, el, emitted, settle, source, mode, editor } = await mount('## Heading\n\nText.');

    mode('Markdown').click();
    await settle();
    expect(source()?.value).toBe('## Heading\n\nText.');
    expect(el.querySelector<HTMLElement>('.rt__body')!.hidden).toBe(true);
    expect(button(el, 'Bold')).toBeNull();                               // no formatting buttons: the text is the Markdown
    expect(localStorage.getItem(STORED_FLAG_PREFIX + 'studio.editMode')).toBe('markdown');

    source()!.value = '## Heading\n\nText, *changed*.';
    source()!.dispatchEvent(new Event('input'));
    expect(emitted.at(-1)).toBe('## Heading\n\nText, *changed*.');
    fixture.componentRef.setInput('markdown', emitted.at(-1)!);           // the host keeps what was typed
    await settle();

    mode('Visual').click();
    await settle();
    expect(editor().querySelector('em')?.textContent).toBe('changed');
  });

  it('opens in the Markdown when that was the last choice', async () => {
    localStorage.setItem(STORED_FLAG_PREFIX + 'studio.editMode', 'markdown');
    const { source } = await mount('Text.');

    expect(source()?.value).toBe('Text.');
  });

  it('cannot be edited when disabled, either way', async () => {
    const { editor, mode, settle, source } = await mount('Locked', true);

    expect(editor().getAttribute('contenteditable')).toBe('false');
    mode('Markdown').click();
    await settle();
    expect(source()?.disabled).toBe(true);
  });

  it('only accepts links with a safe address, and embeds approved videos as a line of HTML in the Markdown', async () => {
    const { el, fixture, editor, emitted, ed } = await mount('Text');
    const submit = async (which: string, value: string) => {
      button(el, which).click();
      fixture.detectChanges();
      const input = el.querySelector<HTMLInputElement>('.rt__prompt input')!;
      input.value = value;
      el.querySelector<HTMLFormElement>('.rt__prompt')!.dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.detectChanges();
    };

    ed().commands.selectAll();
    await submit('Link', 'javascript:alert(1)');
    expect(el.querySelector('.rt__error')?.textContent).toContain('Use an address');
    expect(editor().querySelector('a')).toBeNull();

    await submit('Link', 'https://example.com/page');
    expect(editor().querySelector('a')?.getAttribute('href')).toBe('https://example.com/page');
    expect(emitted.at(-1)).toBe('[Text](https://example.com/page)');

    await submit('Embed a YouTube', 'https://evil.example/v.mp4');
    expect(el.querySelector('.rt__error')?.textContent).toContain('Only YouTube and Vimeo');
    expect(editor().querySelector('iframe')).toBeNull();

    await submit('Embed a YouTube', 'https://youtu.be/dQw4w9WgXcQ');
    expect(editor().querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(emitted.at(-1)).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>');
  });

  it('reads a video embed back from the Markdown, and drops frames from anywhere but the approved hosts', async () => {
    const { editor } = await mount('Text\n\n<iframe src="https://evil.example/x"></iframe>\n\n<iframe src="https://player.vimeo.com/video/76979871"></iframe>');

    const srcs = [...editor().querySelectorAll('iframe')].map((f) => f.getAttribute('src'));
    expect(srcs).toEqual(['https://player.vimeo.com/video/76979871']);
  });

  it('keeps tables as Markdown tables', async () => {
    const { editor, ed } = await mount('| Unit | KIA |\n| --- | --- |\n| D Coy | 17 |');

    expect(editor().querySelector('td')?.textContent).toBe('D Coy');
    expect(ed().getMarkdown()).toContain('| D Coy');
  });

  it('inserts a picture from the library at the cursor, as Markdown in the Markdown', async () => {
    const visual = await mount('Text');
    visual.fixture.componentInstance.insertImage('/media/aa/abc.jpg', 'A patrol');
    const img = visual.editor().querySelector('img');
    expect([img?.getAttribute('src'), img?.getAttribute('alt')]).toEqual(['/media/aa/abc.jpg', 'A patrol']);

    const md = await mount('First.\n\nSecond.');
    md.mode('Markdown').click();
    await md.settle();
    md.source()!.setSelectionRange(6, 6);
    md.fixture.componentInstance.insertImage('/media/aa/abc.jpg', 'A [patrol]');
    expect(md.emitted.at(-1)).toBe('First.\n\n![A patrol](/media/aa/abc.jpg)\n\nSecond.');
  });

  it('asks its host to open the picture library, either way', async () => {
    const { fixture, el, mode, settle } = await mount('Text');
    let asked = 0;
    fixture.componentInstance.pickImage.subscribe(() => asked++);

    button(el, 'Insert a picture').click();
    mode('Markdown').click();
    await settle();
    button(el, 'Insert a picture').click();

    expect(asked).toBe(2);
  });
});
