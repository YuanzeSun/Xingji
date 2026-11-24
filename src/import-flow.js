export function createImportFlow() {
  return {
    task: null,
    backup: null,
    start(kind, context, view) {
      if (this.task) return null;
      return this.task = { kind, context, view };
    },
    finish(task) {
      if (this.task !== task) return false;
      this.task = null;
      return true;
    },
    clear() {
      this.task = null;
      this.backup = null;
    }
  };
}
