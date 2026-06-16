function visibleElements<T extends HTMLElement>(elements: Iterable<T>): T[] {
  return [...elements].filter((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  });
}

function buttonByTextOrLabel(pattern: RegExp): HTMLButtonElement | null {
  const buttons = visibleElements(document.querySelectorAll<HTMLButtonElement>("button"));
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

export function findGenerateButton(): HTMLButtonElement | null {
  return buttonByTextOrLabel(/generate|create|submit/i);
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

export function findDownloadButtonForNewestResult(): HTMLButtonElement | null {
  const cards = findResultCards();
  for (const card of cards.slice().reverse()) {
    const button = [...card.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => {
      const label = candidate.getAttribute("aria-label") ?? "";
      const text = candidate.textContent ?? "";
      return /download|save/i.test(label) || /download|save/i.test(text);
    });
    if (button && !button.disabled) return button;
  }

  const fallback = buttonByTextOrLabel(/download|save/i);
  return fallback && !fallback.disabled ? fallback : null;
}

export function setPromptText(input: HTMLElement, prompt: string): void {
  input.focus();

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    input.value = prompt;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  input.textContent = prompt;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
}

function isEditableInput(element: HTMLElement): boolean {
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement ||
    element.isContentEditable
  );
}
