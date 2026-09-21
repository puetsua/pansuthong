type InputWithHidePicker = HTMLInputElement & { hidePicker?: () => void };

function callHidePickerIfSupported(input: HTMLInputElement): void {
  const hidePicker = (input as InputWithHidePicker).hidePicker;
  if (typeof hidePicker !== "function") return;
  try {
    hidePicker.call(input);
  } catch {
    // hidePicker unsupported or not allowed (e.g. jsdom)
  }
}

/** Dismiss the platform native picker for `<input type="date">` (WebKitGTK #237). */
export function dismissNativeDatePicker(input: HTMLInputElement): void {
  callHidePickerIfSupported(input);
  input.blur();
}

/** Close any open native date pickers under `container`, optionally keeping one field. */
export function dismissOpenDatePickersIn(
  container: ParentNode,
  except?: HTMLInputElement | null,
): void {
  if (!(container instanceof Element)) return;
  for (const el of container.querySelectorAll('input[type="date"]')) {
    if (!(el instanceof HTMLInputElement)) continue;
    if (el === except) continue;
    dismissNativeDatePicker(el);
  }
}

/**
 * Task editor capture handler: WebKitGTK can leave a native date popup open and
 * block clicks (Cancel) after focus moves. Dismiss pickers before the click lands.
 */
export function handleEditorDatePickerPointerDownCapture(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const editor = target.closest(".task-editor");
  if (!editor) return;

  const dateControl = target.closest('input[type="date"], input.te-date-unset');
  const except =
    dateControl instanceof HTMLInputElement && dateControl.type === "date"
      ? dateControl
      : null;

  dismissOpenDatePickersIn(editor, except);
}
