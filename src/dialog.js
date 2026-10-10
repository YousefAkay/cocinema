// One confirmation dialog for the whole app ("Leave and keep your ratings?", "Start over?").
// It is a native modal <dialog>: the page behind it is inert, so focus stays inside, Tab cycles
// between its two buttons, and Escape closes it as "cancel". Focus goes to the cancel button
// first (the safe choice) and returns to whatever had it before when the dialog closes. All
// text is set with textContent.

let open = false;

export function isDialogOpen() {
  return open;
}

// Resolves true when the person confirms and false for anything else (cancel button, Escape).
// returnFocus: an element to focus afterwards when the one focused before no longer exists.
export function confirmDialog({ title, body, cancelLabel, confirmLabel, returnFocus = null }) {
  if (open) {
    return Promise.resolve(false);
  }
  open = true;

  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';

  const heading = document.createElement('h2');
  heading.id = 'confirm-dialog-title';
  heading.textContent = title;
  dialog.setAttribute('aria-labelledby', heading.id);

  const text = document.createElement('p');
  text.id = 'confirm-dialog-body';
  text.textContent = body;
  dialog.setAttribute('aria-describedby', text.id);

  const actions = document.createElement('div');
  actions.className = 'confirm-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'confirm-cancel';
  cancel.textContent = cancelLabel;
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'confirm-ok';
  confirm.textContent = confirmLabel;
  actions.append(cancel, confirm);
  dialog.append(heading, text, actions);

  return new Promise(resolve => {
    let answer = false;
    // A second request can arrive before the browser has sent the "close" event, so the flag is
    // cleared as soon as a button is pressed.
    cancel.addEventListener('click', () => {
      open = false;
      dialog.close();
    });
    confirm.addEventListener('click', () => {
      answer = true;
      open = false;
      dialog.close();
    });
    // Tab and Shift+Tab cycle between the two buttons, so focus never leaves the dialog.
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const buttons = [cancel, confirm];
      const index = buttons.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
      event.preventDefault();
      buttons[next].focus();
    });
    // Escape fires "cancel" and then closes the dialog on its own.
    dialog.addEventListener('close', () => {
      open = false;
      dialog.remove();
      const target = opener && opener.isConnected && opener !== document.body ? opener : returnFocus;
      if (target && target.isConnected) {
        target.focus({ preventScroll: true });
      }
      resolve(answer);
    });

    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
