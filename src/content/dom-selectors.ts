function visibleElements<T extends HTMLElement>(elements: Iterable<T>): T[] {
  return [...elements].filter((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  });
}

function buttonByTextOrLabel(pattern: RegExp): HTMLElement | null {
  const buttons = visibleElements(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
  return (
    buttons.find((button) => {
      const label = button.getAttribute("aria-label") ?? "";
      const text = button.textContent ?? "";
      return pattern.test(label) || pattern.test(text);
    }) ?? null
  );
}

export function findPromptInput(): HTMLElement | null {
  const labelled = document.querySelector<HTMLElement>(
    '[aria-label*="prompt" i], [aria-label*="describe" i]'
  );
  if (labelled && isEditableInput(labelled)) return labelled;

  return (
    visibleElements(document.querySelectorAll<HTMLTextAreaElement>("textarea"))[0] ??
    visibleElements(document.querySelectorAll<HTMLElement>('[contenteditable="true"]'))[0] ??
    null
  );
}

export function findGenerateButton(promptInput?: HTMLElement): HTMLElement | null {
  return findNearbyPromptButton(promptInput);
}

export function findResultCards(): HTMLElement[] {
  const candidates = document.querySelectorAll<HTMLElement>(
    '[data-testid*="result" i], [aria-label*="result" i], article, [role="article"], [class*="result" i]'
  );
  return visibleElements(candidates);
}

export function findLoadingIndicators(): HTMLElement[] {
  return visibleElements(
    document.querySelectorAll<HTMLElement>(
      '[aria-busy="true"], [role="progressbar"], [class*="loading" i], [class*="spinner" i]'
    )
  );
}

export function findDownloadButtonForNewestResult(): HTMLElement | null {
  const cards = findResultCards();
  for (const card of cards.slice().reverse()) {
    const button = [...card.querySelectorAll<HTMLElement>('button, [role="button"]')].find((candidate) => {
      const label = candidate.getAttribute("aria-label") ?? "";
      const text = candidate.textContent ?? "";
      return /download|save/i.test(label) || /download|save/i.test(text);
    });
    if (button && !isDisabled(button)) return button;
  }

  const fallback = buttonByTextOrLabel(/download|save/i);
  return fallback && !isDisabled(fallback) ? fallback : null;
}

export function setPromptText(input: HTMLElement, prompt: string): void {
  input.focus();

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    setNativeInputValue(input, prompt);
    dispatchTextEvents(input, prompt);
    return;
  }

  insertContentEditableText(input, prompt);
  dispatchTextEvents(input, prompt);
}

function isEditableInput(element: HTMLElement): boolean {
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement ||
    element.isContentEditable
  );
}

function findNearbyPromptButton(promptInput?: HTMLElement): HTMLElement | null {
  if (!promptInput) return null;

  let parent = promptInput.parentElement;
  for (let depth = 0; parent && depth < 8; depth += 1) {
    const parentRect = parent.getBoundingClientRect();
    const inputRect = promptInput.getBoundingClientRect();
    const inputCenterY = inputRect.top + inputRect.height / 2;
    const looksLikeComposer =
      parentRect.width >= inputRect.width &&
      parentRect.width <= Math.max(inputRect.width + 900, 320) &&
      Math.abs(parentRect.bottom - inputRect.bottom) < 160 &&
      parentRect.bottom > window.innerHeight * 0.45;

    if (looksLikeComposer) {
      const buttons = visibleElements(parent.querySelectorAll<HTMLElement>('button, [role="button"]'))
        .filter((button) => isPossibleSubmitButton(button, inputRect, inputCenterY))
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);

      if (buttons.length > 0) return buttons[0] ?? null;
    }

    parent = parent.parentElement;
  }

  return null;
}

function setNativeInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
}

function dispatchTextEvents(input: HTMLElement, prompt: string): void {
  input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: prompt }));
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " ", code: "Space" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function insertContentEditableText(input: HTMLElement, prompt: string): void {
  input.focus();

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand("insertText", false, prompt);
  if (!inserted) {
    input.textContent = prompt;
  }
}

function isPossibleSubmitButton(button: HTMLElement, inputRect: DOMRect, inputCenterY: number): boolean {
  const label = button.getAttribute("aria-label") ?? "";
  const title = button.getAttribute("title") ?? "";
  const text = button.textContent?.trim() ?? "";
  const combined = `${label} ${title} ${text}`;
  const rect = button.getBoundingClientRect();
  const centerY = rect.top + rect.height / 2;

  if (isDisabled(button)) return false;
  if (/add|upload|media|attach|agent|settings|filter|tune|menu|back|project|home|collapse|trash|voice|mic/i.test(combined)) {
    return false;
  }
  if (text === "+" || text.toLowerCase() === "agent") return false;

  const verticallyAligned = Math.abs(centerY - inputCenterY) < Math.max(inputRect.height, 80);
  const toRightOfPrompt = rect.left > inputRect.left + Math.min(160, inputRect.width * 0.35);
  const compactAction = rect.width <= 96 && rect.height <= 96;

  return verticallyAligned && toRightOfPrompt && compactAction;
}

function isDisabled(element: HTMLElement): boolean {
  return (
    (element instanceof HTMLButtonElement && element.disabled) ||
    element.getAttribute("aria-disabled") === "true" ||
    element.getAttribute("disabled") !== null
  );
}
