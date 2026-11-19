export function bindTestDialogs(window) {
  const dialog = window.HTMLDialogElement.prototype;
  dialog.showModal = function () { this.open = true; };
  dialog.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
}

export function applyStatisticsDate(root, selector, value) {
  root.querySelector(selector).click();
  const form = root.querySelector('.statistics-date-dialog form');
  form.elements.date.value = value;
  form.querySelector('[type="submit"]').click();
}
