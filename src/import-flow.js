export function createImportFlow() {
  return {
    task: null,
    entries: [],
    selected: new Set(),
    batch: false,
    backup: null,
    review: 'closed',
    get phase() {
      if (this.review !== 'closed') return this.review;
      if (this.task) return 'reading';
      return this.entries.length || this.backup ? 'ready' : 'idle';
    },
    start(kind, context, view) {
      if (this.task) return null;
      return this.task = { kind, context, view };
    },
    finish(task) {
      if (this.task !== task) return false;
      this.task = null;
      return true;
    },
    discardEntries() {
      this.entries = [];
      this.selected.clear();
      this.batch = false;
      this.review = 'closed';
    },
    clear() {
      this.task = null;
      this.backup = null;
      this.discardEntries();
    }
  };
}
