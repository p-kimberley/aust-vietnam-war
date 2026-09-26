import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ChainedCommands, Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { storedChoice } from '../battlemap/stored-flag';
import { VideoEmbed, toEmbedUrl } from './video-embed';

/** How the body is being edited: formatted as it will look (the default), or as the Markdown it is kept as. */
export type EditMode = 'visual' | 'markdown';

type Bar = 'link' | 'video' | null;

/**
 * The article body editor. Bodies are kept as Markdown; this edits them either visually (TipTap, with the formatting the site
 * allows: headings, bold, italic, strikethrough, lists, quotes, links, pictures, tables, approved video embeds), or as the
 * Markdown itself, and remembers which the editor last chose. Both read and write the same Markdown. A video embed, which
 * Markdown has no form for, is a line of HTML. The server renders and sanitises again on every save, so this limits what an
 * editor can try rather than what a reader can receive.
 */
@Component({
  selector: 'app-rich-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (editor(); as ed) {
      <div class="rt__bar" role="toolbar" aria-label="Formatting">
        @if (mode() === 'markdown') {
          <button type="button" (click)="pickImage.emit()" title="Insert a picture from the library">Picture</button>
          <a class="rt__help" href="https://commonmark.org/help/" target="_blank" rel="noopener noreferrer">Markdown help</a>
        } @else {
        <button type="button" (click)="run((c) => c.toggleHeading({ level: 2 }))" [class.is-on]="on('heading', { level: 2 })" title="Heading">H2</button>
        <button type="button" (click)="run((c) => c.toggleHeading({ level: 3 }))" [class.is-on]="on('heading', { level: 3 })" title="Subheading">H3</button>
        <span class="rt__sep"></span>
        <button type="button" (click)="run((c) => c.toggleBold())" [class.is-on]="on('bold')" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" (click)="run((c) => c.toggleItalic())" [class.is-on]="on('italic')" title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" (click)="run((c) => c.toggleStrike())" [class.is-on]="on('strike')" title="Strikethrough"><s>S</s></button>
        <span class="rt__sep"></span>
        <button type="button" (click)="run((c) => c.toggleBulletList())" [class.is-on]="on('bulletList')" title="Bulleted list">• List</button>
        <button type="button" (click)="run((c) => c.toggleOrderedList())" [class.is-on]="on('orderedList')" title="Numbered list">1. List</button>
        <button type="button" (click)="run((c) => c.toggleBlockquote())" [class.is-on]="on('blockquote')" title="Quote">Quote</button>
        <span class="rt__sep"></span>
        <button type="button" (click)="openBar('link')" [class.is-on]="on('link')" title="Link">Link</button>
        <button type="button" (click)="pickImage.emit()" title="Insert a picture from the library">Picture</button>
        <button type="button" (click)="openBar('video')" title="Embed a YouTube or Vimeo video">Video</button>
        <button type="button" (click)="run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))" title="Insert a table">Table</button>
        @if (on('table')) {
          <button type="button" (click)="run((c) => c.addRowAfter())" title="Add a row below">+ Row</button>
          <button type="button" (click)="run((c) => c.addColumnAfter())" title="Add a column to the right">+ Col</button>
          <button type="button" (click)="run((c) => c.deleteTable())" title="Delete the table">− Table</button>
        }
        <button type="button" (click)="run((c) => c.setHorizontalRule())" title="Divider">―</button>
        <span class="rt__sep"></span>
        <button type="button" (click)="run((c) => c.undo())" [disabled]="!ed.can().undo()" title="Undo">Undo</button>
        <button type="button" (click)="run((c) => c.redo())" [disabled]="!ed.can().redo()" title="Redo">Redo</button>
        }
        <div class="rt__modes" role="group" aria-label="Edit the text">
          <button type="button" [class.is-on]="mode() === 'visual'" [attr.aria-pressed]="mode() === 'visual'" (click)="setMode('visual')">Visual</button>
          <button type="button" [class.is-on]="mode() === 'markdown'" [attr.aria-pressed]="mode() === 'markdown'" (click)="setMode('markdown')">Markdown</button>
        </div>
      </div>

      @if (bar(); as which) {
        <form class="rt__prompt" (submit)="$event.preventDefault(); applyBar(which, address.value)">
          <label>
            {{ which === 'link' ? 'Link address' : 'YouTube or Vimeo address' }}
            <input #address type="url" required [placeholder]="which === 'link' ? 'https://…' : 'https://www.youtube.com/watch?v=…'" />
          </label>
          <button type="submit" class="btn">{{ which === 'link' ? 'Set link' : 'Embed' }}</button>
          @if (which === 'link' && on('link')) {
            <button type="button" class="btn btn--quiet" (click)="removeLink()">Remove link</button>
          }
          <button type="button" class="btn btn--quiet" (click)="bar.set(null)">Cancel</button>
          @if (barError()) {
            <span class="rt__error" role="alert">{{ barError() }}</span>
          }
        </form>
      }
    }
    <div #host class="rt__body" [hidden]="mode() === 'markdown'"></div>
    @if (mode() === 'markdown') {
      <textarea
        #source
        class="rt__md"
        aria-label="The text, in Markdown"
        spellcheck="true"
        [value]="markdown()"
        [disabled]="disabled()"
        (input)="changed.emit($any($event.target).value)"
      ></textarea>
    }
  `,
  styles: `
    app-rich-text {
      display: block;
      border: 1px solid var(--rule);
      border-radius: var(--radius);
      background: #fff;
    }
    .rt__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
      padding: 0.4rem;
      border-bottom: 1px solid var(--rule);
      background: var(--surface-raised);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .rt__bar button {
      min-width: 2.2rem;
      padding: 0.25rem 0.5rem;
      border: 1px solid transparent;
      border-radius: var(--radius);
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-size: 0.95rem;
      cursor: pointer;
    }
    .rt__bar button:hover:not(:disabled) {
      border-color: var(--rule);
    }
    .rt__bar button.is-on {
      background: var(--olive-900);
      color: var(--paper);
    }
    .rt__bar button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .rt__modes {
      display: flex;
      gap: 0.15rem;
      margin-left: auto;
      padding: 0.1rem;
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    .rt__help {
      margin-left: 0.5rem;
      font-size: 0.85rem;
    }
    .rt__md {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 22rem;
      padding: 1rem 1.25rem;
      color: var(--ink);
      font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
      font-size: 0.95rem;
      line-height: 1.6;
      background: #fff;
      border: 0;
      resize: vertical;
      outline: none;
    }
    .rt__sep {
      width: 1px;
      align-self: stretch;
      background: var(--rule);
      margin-inline: 0.25rem;
    }
    .rt__prompt {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 0.5rem;
      padding: 0.5rem;
      border-bottom: 1px solid var(--rule);
      background: #fffbe8;
    }
    .rt__prompt label {
      display: grid;
      flex: 1;
      min-width: 16rem;
      gap: 0.2rem;
      font-size: 0.9rem;
    }
    .rt__prompt input {
      padding: 0.4rem;
      font: inherit;
    }
    .rt__error {
      flex-basis: 100%;
      color: var(--contact-red);
    }
    .rt__body .tiptap {
      min-height: 22rem;
      padding: 1rem 1.25rem;
      outline: none;
      font-size: 1.05rem;
      line-height: 1.65;
    }
    .rt__body .tiptap > :first-child {
      margin-top: 0;
    }
    .rt__body .tiptap h2,
    .rt__body .tiptap h3 {
      margin: 1.4em 0 0.4em;
    }
    .rt__body .tiptap li > p {
      margin: 0.2em 0;
    }
    .rt__body .tiptap blockquote {
      margin-inline: 0;
      padding-left: 1rem;
      border-left: 4px solid var(--brass);
      font-style: italic;
    }
    .rt__body .tiptap img,
    .rt__body .tiptap iframe {
      max-width: 100%;
      height: auto;
    }
    .rt__body .tiptap iframe {
      width: 100%;
      aspect-ratio: 16 / 9;
      border: 0;
      pointer-events: none;
    }
    .rt__body .tiptap .ProseMirror-selectednode {
      outline: 3px solid var(--focus);
    }
    .rt__body .tiptap table {
      border-collapse: collapse;
      width: 100%;
    }
    .rt__body .tiptap th,
    .rt__body .tiptap td {
      border: 1px solid var(--rule);
      padding: 0.3rem 0.5rem;
      min-width: 3rem;
      vertical-align: top;
    }
    .rt__body .tiptap th {
      background: var(--surface-raised);
    }
  `,
})
export class RichText implements OnDestroy {
  /** The body, as Markdown. Changes that did not come from typing here replace the text; typing here does not loop back. */
  readonly markdown = input.required<string>();
  readonly disabled = input(false);
  readonly changed = output<string>();
  /** The host opens its picture library, then calls {@link insertImage}. */
  readonly pickImage = output<void>();

  protected readonly editor = signal<Editor | null>(null);
  protected readonly bar = signal<Bar>(null);
  protected readonly barError = signal('');
  private readonly tick = signal(0);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly source = viewChild<ElementRef<HTMLTextAreaElement>>('source');
  /** Visual or Markdown; the browser remembers the choice from one visit to the next. */
  protected readonly mode = storedChoice<EditMode>('studio.editMode', ['visual', 'markdown'], 'visual');

  constructor() {
    afterNextRender(() => {
      const ed = new Editor({
        element: this.host().nativeElement,
        content: this.markdown(),
        contentType: 'markdown',
        editable: !this.disabled(),
        extensions: [
          // No underline: Markdown has none, and underlined words on a web page look like links.
          StarterKit.configure({ heading: { levels: [2, 3] }, underline: false, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } } }),
          Markdown,
          Image.configure({ inline: false }),
          Table.configure({ resizable: false }),
          TableRow,
          TableHeader,
          TableCell,
          VideoEmbed,
        ],
        onUpdate: ({ editor }) => {
          // TipTap tidies what it is given (and may report that as an update); only a real difference is a change.
          const out = editor.isEmpty ? '' : editor.getMarkdown();
          if (out !== this.markdown()) {
            this.changed.emit(out);
          }
        },
        onTransaction: () => this.tick.update((n) => n + 1),
      });
      this.editor.set(ed);
    });

    effect(() => {
      const markdown = this.markdown();
      const ed = this.editor();
      // Only replace the text when it differs from what the editor already holds (a restored revision, a reload). While the
      // Markdown is being typed, the visual editor catches up when it is switched back to.
      if (ed && this.mode() === 'visual') {
        this.load(ed, markdown);
      }
    });

    effect(() => this.editor()?.setEditable(!this.disabled()));
  }

  /** Whether a mark or node is active at the cursor. Reads the transaction counter so the toolbar redraws as the cursor moves. */
  protected on(name: string, attributes?: Record<string, unknown>): boolean {
    this.tick();
    return this.editor()?.isActive(name, attributes) ?? false;
  }

  protected run(command: (chain: ChainedCommands) => ChainedCommands): void {
    const ed = this.editor();
    if (ed) {
      command(ed.chain().focus()).run();
    }
  }

  protected openBar(which: 'link' | 'video'): void {
    this.barError.set('');
    this.bar.set(which);
  }

  protected applyBar(which: 'link' | 'video', address: string): void {
    const ed = this.editor();
    if (!ed) {
      return;
    }
    if (which === 'link') {
      if (!/^(https?:\/\/|mailto:|\/)/i.test(address.trim())) {
        this.barError.set('Use an address that starts with https://, http://, mailto: or /.');
        return;
      }
      ed.chain().focus().extendMarkRange('link').setLink({ href: address.trim() }).run();
    } else {
      const src = toEmbedUrl(address);
      if (!src) {
        this.barError.set('Only YouTube and Vimeo addresses can be embedded.');
        return;
      }
      ed.chain().focus().insertContent({ type: 'videoEmbed', attrs: { src } }).run();
    }
    this.bar.set(null);
  }

  protected removeLink(): void {
    this.editor()?.chain().focus().extendMarkRange('link').unsetLink().run();
    this.bar.set(null);
  }

  /** Switches between editing visually and editing the Markdown; the text is the same either way. */
  protected setMode(mode: EditMode): void {
    const ed = this.editor();
    if (mode === 'visual' && ed) {
      this.load(ed, this.markdown());
    }
    this.mode.set(mode);
  }

  private load(ed: Editor, markdown: string): void {
    if (markdown !== (ed.isEmpty ? '' : ed.getMarkdown())) {
      ed.commands.setContent(markdown, { emitUpdate: false, contentType: 'markdown' });
    }
  }

  /** Puts a picture from the library at the cursor (as Markdown, when the Markdown is being edited). */
  insertImage(src: string, alt: string): void {
    const area = this.source()?.nativeElement;
    if (this.mode() === 'markdown' && area) {
      const text = `![${alt.replace(/[[\]]/g, '')}](${src})`;
      const at = area.selectionStart ?? area.value.length;
      const before = area.value.slice(0, at);
      const after = area.value.slice(at);
      const gap = (s: string) => (s === '' || s.endsWith('\n\n') ? '' : s.endsWith('\n') ? '\n' : '\n\n');
      this.changed.emit(`${before}${gap(before)}${text}\n\n${after.replace(/^\n+/, '')}`);
      return;
    }
    this.editor()?.chain().focus().setImage({ src, alt }).run();
  }

  ngOnDestroy(): void {
    this.editor()?.destroy();
  }
}
