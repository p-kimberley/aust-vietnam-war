import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';
import { UnitTree } from './unit-tree';

/**
 * The unit hierarchy as nested checkboxes. Ticking a unit ticks everything beneath it, a unit with only some of its
 * subordinates ticked shows the mixed state, and the search box narrows the tree to matching units while keeping the
 * path to each. Built from plain lists, buttons and checkboxes so it works with the keyboard and screen readers.
 */
@Component({
  selector: 'app-unit-tree',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unit-tree-view.html',
  styleUrl: './unit-tree-view.css',
})
export class UnitTreeView implements OnInit {
  readonly tree = input.required<UnitTree>();
  /** The real unit ids currently selected. */
  readonly selected = input.required<ReadonlySet<number>>();
  /** Contacts per node, for the counts beside each unit. */
  readonly counts = input.required<ReadonlyMap<number, number>>();
  /** A node was ticked or unticked. The parent computes the new selection with {@link UnitTree.toggle}. */
  readonly toggled = output<number>();

  protected readonly query = signal('');
  private readonly opened = signal<ReadonlySet<number>>(new Set());
  protected readonly search = computed(() => this.tree().search(this.query()));
  protected readonly roots = computed(() => this.tree().roots.filter((id) => this.visible(id)));

  ngOnInit(): void {
    // Open the path to whatever is already selected (for example from a link), so it can be seen.
    const open = new Set<number>();
    for (const entry of this.tree().cover(this.selected())) {
      this.tree().ancestors(entry.id).forEach((a) => open.add(a));
    }
    this.opened.set(open);
  }

  protected visible(id: number): boolean {
    const s = this.search();
    return !s || s.visible.has(id);
  }

  protected children(id: number): readonly number[] {
    return this.tree().children(id).filter((c) => this.visible(c));
  }

  protected hasChildren(id: number): boolean {
    return this.tree().children(id).length > 0;
  }

  protected isOpen(id: number): boolean {
    return this.opened().has(id) || (this.search()?.open.has(id) ?? false);
  }

  protected toggleOpen(id: number): void {
    const next = new Set(this.opened());
    if (this.isOpen(id)) next.delete(id);
    else next.add(id);
    this.opened.set(next);
  }

  protected state(id: number) {
    return this.tree().stateOf(id, this.selected());
  }

  protected label(id: number): string {
    return this.tree().get(id)?.label ?? '';
  }

  protected name(id: number): string {
    return this.tree().get(id)?.name ?? '';
  }
}
