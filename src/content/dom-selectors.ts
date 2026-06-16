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
  const textControls = visibleElements(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type="text"], input:not([type])')
  ).filter(isPromptLikeTextControl);
  const bottomTextControl = textControls.sort(
    (a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom
  )[0];
  if (bottomTextControl) return bottomTextControl;

  const labelled = document.querySelector<HTMLElement>(
    '[aria-label*="prompt" i], [aria-label*="describe" i]'
  );
  if (labelled && isEditableInput(labelled) && isInComposerArea(labelled)) return labelled;

  return visibleElements(document.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
    .filter(isInComposerArea)
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] ?? null;
}

export function findGenerateButton(promptInput?: HTMLElement): HTMLElement | null {
  return findNearbyPromptButton(promptInput);
}

export function findResultCards(): HTMLElement[] {
  const candidates = document.querySelectorAll<HTMLElement>(
    '[data-testid*="result" i], [data-testid*="asset" i], [aria-label*="result" i], [aria-label*="asset" i], article, [role="article"], [class*="result" i], [class*="asset" i]'
  );
  return uniqueElements([...visibleElements(candidates), ...findGeneratedMediaElements()]);
}

export function findGeneratedMediaElements(): HTMLElement[] {
  const candidates = document.querySelectorAll<HTMLElement>(
    'img, video, canvas, [role="img"], [aria-label*="image" i], [aria-label*="video" i], [aria-label*="media" i]'
  );

  return visibleElements(candidates).filter((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 96 || rect.height < 96) return false;
    if (isInComposerArea(element)) return false;
    if (isInsideNavigation(element)) return false;
    return true;
  });
}

export function findNewestGeneratedMediaElement(): HTMLElement | null {
  return (
    findGeneratedMediaElements().sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bRect.right + bRect.bottom - (aRect.right + aRect.bottom);
    })[0] ?? null
  );
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
    const button = findDownloadButtonIn(card);
    if (button && !isDisabled(button)) return button;
  }

  const fallback = buttonByTextOrLabel(/download|save/i);
  return fallback && !isDisabled(fallback) ? fallback : null;
}

export function findDownloadButtonNearNewestMedia(): HTMLElement | null {
  const media = findNewestGeneratedMediaElement();
  if (!media) return findDownloadButtonForNewestResult();

  let parent = media.parentElement;
  for (let depth = 0; parent && depth < 8; depth += 1) {
    const button = findDownloadButtonIn(parent);
    if (button && !isDisabled(button)) return button;
    parent = parent.parentElement;
  }

  return findDownloadButtonForNewestResult();
}

export function findOverflowMenuButtonNearNewestMedia(): HTMLElement | null {
  const media = findNewestGeneratedMediaElement();
  if (!media) return null;

  const mediaRect = media.getBoundingClientRect();
  let parent = media.parentElement;
  for (let depth = 0; parent && depth < 8; depth += 1) {
    const parentRect = parent.getBoundingClientRect();
    const isLikelyMediaCard =
      parentRect.width >= mediaRect.width &&
      parentRect.height >= mediaRect.height &&
      parentRect.width <= mediaRect.width + 260 &&
      parentRect.height <= mediaRect.height + 260;

    if (isLikelyMediaCard) {
      const menuButton = visibleElements(parent.querySelectorAll<HTMLElement>('button, [role="button"]'))
        .filter((button) => isPossibleOverflowMenuButton(button, mediaRect, parentRect))
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];

      if (menuButton) return menuButton;
    }

    parent = parent.parentElement;
  }

  return null;
}

export function setPromptText(input: HTMLElement, prompt: string): void {
  input.focus();

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    setNativeInputValue(input, prompt);
    dispatchTextEvents(input, prompt);
    return;
  }

  dispatchPasteEvents(input, prompt);
  dispatchTextEvents(input, prompt);
}

function isEditableInput(element: HTMLElement): boolean {
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement ||
    element.isContentEditable
  );
}

function isPromptLikeTextControl(input: HTMLInputElement | HTMLTextAreaElement): boolean {
  const combined = [
    input.placeholder,
    input.getAttribute("aria-label"),
    input.getAttribute("name"),
    input.getAttribute("data-testid")
  ]
    .filter(Boolean)
    .join(" ");

  const rejects = /search|filter|title|name|email|password|url/i.test(combined);
  const accepts =
    /prompt|describe|create|want|message/i.test(combined) ||
    input instanceof HTMLTextAreaElement ||
    isInComposerArea(input);

  return accepts && !rejects && isInComposerArea(input);
}

function isInComposerArea(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 12) return false;
  return rect.bottom > window.innerHeight * 0.55;
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

function dispatchPasteEvents(input: HTMLElement, prompt: string): void {
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", prompt);

  input.dispatchEvent(
    new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData
    })
  );
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

function findDownloadButtonIn(root: ParentNode): HTMLElement | null {
  return (
    [...root.querySelectorAll<HTMLElement>('button, [role="button"], a[download], a[href]')].find((candidate) => {
      const label = candidate.getAttribute("aria-label") ?? "";
      const title = candidate.getAttribute("title") ?? "";
      const href = candidate.getAttribute("href") ?? "";
      const text = candidate.textContent ?? "";
      return /download|save/i.test(`${label} ${title} ${text} ${href}`);
    }) ?? null
  );
}

function isPossibleOverflowMenuButton(button: HTMLElement, mediaRect: DOMRect, parentRect: DOMRect): boolean {
  const label = button.getAttribute("aria-label") ?? "";
  const title = button.getAttribute("title") ?? "";
  const text = button.textContent?.trim() ?? "";
  const combined = `${label} ${title} ${text}`;
  const rect = button.getBoundingClientRect();

  if (isDisabled(button)) return false;
  if (/download|save|back|project|home|trash|delete|remove|close/i.test(combined)) return false;

  const compact = rect.width <= 64 && rect.height <= 64;
  const inCard = rect.left >= parentRect.left && rect.right <= parentRect.right && rect.top >= parentRect.top && rect.bottom <= parentRect.bottom;
  const nearMediaTopRight = rect.right > mediaRect.right - 120 && rect.top < mediaRect.top + 100;
  const labelledAsMenu = /more|option|menu|action|overflow/i.test(combined) || /⋮|…|\.\.\./.test(text);
  const hasMenuPopup = button.getAttribute("aria-haspopup") === "menu" || button.getAttribute("aria-expanded") !== null;

  return compact && inCard && nearMediaTopRight && (labelledAsMenu || hasMenuPopup || text.length === 0);
}

function isInsideNavigation(element: HTMLElement): boolean {
  return Boolean(
    element.closest(
      'nav, header, aside, [role="navigation"], [aria-label*="navigation" i], [aria-label*="sidebar" i]'
    )
  );
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return [...new Set(elements)];
}
