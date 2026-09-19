import { Contact } from './contacts';
import { UnitNode } from './filter-catalogue';

export type CheckState = 'all' | 'some' | 'none';

/** One entry of a compact selection: a node's whole subtree, or a single real unit on its own. */
export interface CoverEntry {
  id: number;
  subtree: boolean;
}

/**
 * The unit hierarchy as a tree, with the operations the filter needs. A unit id above zero is a real unit that
 * contacts refer to; a negative id is a grouping node. Selecting a node selects every real unit beneath it, so the
 * selection is always a set of real unit ids, and that set is what contacts are matched against.
 */
export class UnitTree {
  readonly nodes: readonly UnitNode[];
  readonly roots: readonly number[];
  private readonly byId = new Map<number, UnitNode>();
  private readonly kids = new Map<number, number[]>();
  /** Real unit ids in each node's subtree, the node itself included when it is real. */
  private readonly real = new Map<number, number[]>();

  constructor(nodes: readonly UnitNode[]) {
    this.nodes = nodes;
    const roots: number[] = [];
    for (const n of nodes) {
      this.byId.set(n.id, n);
    }
    for (const n of nodes) {
      if (n.parent !== null && this.byId.has(n.parent)) {
        const siblings = this.kids.get(n.parent) ?? [];
        siblings.push(n.id);
        this.kids.set(n.parent, siblings);
      } else {
        roots.push(n.id);
      }
    }
    this.roots = roots;
    // The catalogue lists parents before children, so walking backwards sees every child before its parent.
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const own = n.id > 0 ? [n.id] : [];
      this.real.set(n.id, own.concat(...(this.kids.get(n.id) ?? []).map((k) => this.real.get(k) ?? [])));
    }
  }

  get(id: number): UnitNode | undefined {
    return this.byId.get(id);
  }

  children(id: number): readonly number[] {
    return this.kids.get(id) ?? [];
  }

  parentOf(id: number): number | null {
    const p = this.byId.get(id)?.parent ?? null;
    return p !== null && this.byId.has(p) ? p : null;
  }

  /** Real unit ids at or beneath a node. */
  realUnits(id: number): readonly number[] {
    return this.real.get(id) ?? [];
  }

  ancestors(id: number): number[] {
    const out: number[] = [];
    for (let p = this.parentOf(id); p !== null; p = this.parentOf(p)) out.push(p);
    return out;
  }

  /** How many distinct contacts involve each node's subtree. A contact counts once however many units it lists. */
  countContacts(contacts: readonly Contact[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const c of contacts) {
      const touched = new Set<number>();
      for (const unit of c.units) {
        if (!this.byId.has(unit)) continue;
        touched.add(unit);
        for (const a of this.ancestors(unit)) touched.add(a);
      }
      for (const id of touched) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  stateOf(id: number, selected: ReadonlySet<number>): CheckState {
    const units = this.realUnits(id);
    if (units.length === 0) return 'none';
    const chosen = units.reduce((n, u) => n + (selected.has(u) ? 1 : 0), 0);
    return chosen === 0 ? 'none' : chosen === units.length ? 'all' : 'some';
  }

  /** Selecting a partly or wholly unselected node selects its whole subtree; toggling a fully selected one clears it. */
  toggle(id: number, selected: ReadonlySet<number>): Set<number> {
    const next = new Set(selected);
    const units = this.realUnits(id);
    if (this.stateOf(id, selected) === 'all') {
      units.forEach((u) => next.delete(u));
    } else {
      units.forEach((u) => next.add(u));
    }
    return next;
  }

  /**
   * The fewest entries that describe a selection: each fully selected subtree is named by its top node, so a battalion
   * is one entry rather than dozens. A real unit that is selected while some of its subordinates are not is named on
   * its own. {@link expand} restores exactly the original selection.
   */
  cover(selected: ReadonlySet<number>): CoverEntry[] {
    const out: CoverEntry[] = [];
    const visit = (id: number) => {
      const state = this.stateOf(id, selected);
      if (state === 'all') {
        out.push({ id, subtree: true });
      } else if (state === 'some') {
        if (id > 0 && selected.has(id)) out.push({ id, subtree: false });
        this.children(id).forEach(visit);
      }
    };
    this.roots.forEach(visit);
    return out;
  }

  /** The inverse of {@link cover}: the real units the entries name. Unknown ids are ignored. */
  expand(entries: readonly CoverEntry[]): Set<number> {
    const out = new Set<number>();
    for (const { id, subtree } of entries) {
      if (subtree) {
        this.realUnits(id).forEach((u) => out.add(u));
      } else if (id > 0 && this.byId.has(id)) {
        out.add(id);
      }
    }
    return out;
  }

  /**
   * Nodes whose label or name contains every word of `query`. Each match is shown with its ancestors (so it can be
   * reached) and its descendants; `open` lists the ancestors that should be expanded to reveal the matches.
   */
  search(query: string): { visible: Set<number>; open: Set<number> } | null {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const visible = new Set<number>();
    const open = new Set<number>();
    const showSubtree = (id: number) => {
      visible.add(id);
      this.children(id).forEach(showSubtree);
    };
    for (const n of this.nodes) {
      const text = `${n.label} ${n.name}`.toLowerCase();
      if (words.every((w) => text.includes(w))) {
        showSubtree(n.id);
        for (const a of this.ancestors(n.id)) {
          visible.add(a);
          open.add(a);
        }
      }
    }
    return { visible, open };
  }
}
