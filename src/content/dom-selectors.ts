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
  const nearby = findNearbyPromptButton(promptInput);
  if (nearby) return nearby;

  const buttons = visibleElements(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
  const scored = buttons.map((button) => {
    const label = button.getAttribute("aria-label") ?? "";
    const title = button.getAttribute("title") ?? "";
    const text = button.textContent?.trim() ?? "";
    const testId = button.getAttribute("data-testid") ?? "";
    const combined = `${label} ${title} ${text} ${testId}`.toLowerCase();

    if (/add|upload|media|attach|agent|settings|filter|tune|menu|back|project|home|collapse|trash|voice|mic/i.test(combined)) {
      return { button, score: -100 };
    }

    let score = 0;
    if (combined.includes("generate")) score += 30;
    else if (combined.includes("send")) score += 20;
    else if (combined.includes("submit")) score += 20;
    else if (combined.includes("run")) score += 15;

    const rect = button.getBoundingClientRect();
    if (rect.bottom > window.innerHeight * 0.5) {
      score += 5;
    }

    return { button, score };
  });

  console.log(
    "Scene Flow candidate global buttons:",
    scored.filter((s) => s.score > 0).map((s) => ({
      html: s.button.outerHTML,
      score: s.score,
      rect: { x: s.button.getBoundingClientRect().left, y: s.button.getBoundingClientRect().top, width: s.button.getBoundingClientRect().width, height: s.button.getBoundingClientRect().height }
    }))
  );

  const best = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  return best?.button ?? null;
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
      if (Math.abs(aRect.top - bRect.top) > 50) {
        return aRect.top - bRect.top;
      }
      return aRect.left - bRect.left;
    })[0] ?? null
  );
}

export function findNewestGeneratedMediaSource(): string | undefined {
  const media = findNewestGeneratedMediaElement();
  if (!media) return undefined;

  if (media instanceof HTMLImageElement) {
    return media.currentSrc || media.src || undefined;
  }

  if (media instanceof HTMLVideoElement) {
    return media.currentSrc || media.src || media.poster || undefined;
  }

  if (media instanceof HTMLCanvasElement) {
    try {
      return media.toDataURL("image/png");
    } catch {
      return undefined;
    }
  }

  const backgroundImage = window.getComputedStyle(media).backgroundImage;
  const backgroundUrl = extractCssUrl(backgroundImage);
  if (backgroundUrl) return backgroundUrl;

  const nestedImage = media.querySelector<HTMLImageElement>("img");
  if (nestedImage) return nestedImage.currentSrc || nestedImage.src || undefined;

  const nestedVideo = media.querySelector<HTMLVideoElement>("video");
  if (nestedVideo) return nestedVideo.currentSrc || nestedVideo.src || nestedVideo.poster || undefined;

  return undefined;
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

export function findOriginalSizeDownloadOption(): HTMLElement | null {
  const candidates = visibleElements(
    document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="option"], button, [role="button"], li, div'
    )
  );

  return (
    candidates
      .filter(isOriginalSizeOption)
      .sort((a, b) => scoreOriginalSizeOption(b) - scoreOriginalSizeOption(a))[0] ?? null
  );
}

export async function setPromptText(input: HTMLElement, prompt: string): Promise<void> {
  const tempId = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  input.setAttribute("data-flow-temp-prompt-id", tempId);
  input.setAttribute("data-flow-temp-prompt-val", prompt);

  const donePromise = new Promise<void>((resolve) => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail && customEvent.detail.tempId === tempId) {
        window.removeEventListener("FLOW_AUTOMATOR_SET_TEXT_DONE", handler);
        resolve();
      }
    };
    window.addEventListener("FLOW_AUTOMATOR_SET_TEXT_DONE", handler);
  });

  const script = document.createElement("script");
  script.textContent = `
    (async function() {
      const tempId = "${tempId}";
      const el = document.querySelector('[data-flow-temp-prompt-id="' + tempId + '"]');
      if (!el) {
        window.dispatchEvent(new CustomEvent('FLOW_AUTOMATOR_SET_TEXT_DONE', { detail: { tempId } }));
        return;
      }
      const val = el.getAttribute("data-flow-temp-prompt-val") || "";
      el.removeAttribute("data-flow-temp-prompt-val");
      el.removeAttribute("data-flow-temp-prompt-id");

      function getReactFiber(node) {
        const key = Object.keys(node).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        return key ? node[key] : null;
      }

      function getSlateEditor(slateRoot) {
        let fiber = getReactFiber(slateRoot);
        while (fiber) {
          try {
            const state = fiber.memoizedState && fiber.memoizedState.memoizedState;
            if (state && state.editor && typeof state.editor.insertText === 'function') {
              return state.editor;
            }
            const props = fiber.memoizedProps;
            if (props && props.editor && typeof props.editor.insertText === 'function') {
              return props.editor;
            }
          } catch (e) {}
          fiber = fiber.return;
        }
        return null;
      }

      try {
        const slateRoot = el.getAttribute('data-slate-editor') === 'true' ? el : el.closest('[data-slate-editor="true"]');
        if (slateRoot) {
          const editor = getSlateEditor(slateRoot);
          if (editor) {
            const firstChild = editor.children && editor.children[0];
            const firstText = firstChild && firstChild.children && firstChild.children[0];
            const existingLen = firstText && firstText.text ? firstText.text.length : 0;
            editor.select({
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [0, 0], offset: existingLen }
            });
            editor.deleteFragment();

            for (let i = 0; i < val.length; i++) {
              editor.insertText(val[i]);
              await new Promise(r => setTimeout(r, Math.floor(Math.random() * (45 - 15 + 1)) + 15));
            }
            slateRoot.dispatchEvent(new Event('input', { bubbles: true }));
            window.dispatchEvent(new CustomEvent('FLOW_AUTOMATOR_SET_TEXT_DONE', { detail: { tempId } }));
            return;
          }
        }
      } catch (e) {
        console.error("Slate inject error:", e);
      }

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        try {
          const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
          if (descriptor && descriptor.set) {
            descriptor.set.call(el, "");
          } else {
            el.value = "";
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));

          for (let i = 0; i < val.length; i++) {
            const char = val[i];
            const currentVal = el.value + char;
            try {
              const pk = Object.keys(el).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
              if (pk && el[pk] && typeof el[pk].onChange === 'function') {
                el[pk].onChange({ target: { value: currentVal }, currentTarget: { value: currentVal }, type: 'change', bubbles: true });
              }
            } catch(e) {}
            if (descriptor && descriptor.set) {
              descriptor.set.call(el, currentVal);
            } else {
              el.value = currentVal;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * (45 - 15 + 1)) + 15));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
          window.dispatchEvent(new CustomEvent('FLOW_AUTOMATOR_SET_TEXT_DONE', { detail: { tempId } }));
          return;
        } catch (e) {
          console.error("Standard input inject error:", e);
        }
      }

      // Fallback
      try {
        el.focus();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand("delete", false);
        }
      } catch (e) {}

      for (let i = 0; i < val.length; i++) {
        const char = val[i];
        let inserted = false;
        try {
          inserted = document.execCommand("insertText", false, char);
        } catch (e) {}
        if (!inserted) {
          el.textContent += char;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * (45 - 15 + 1)) + 15));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      window.dispatchEvent(new CustomEvent('FLOW_AUTOMATOR_SET_TEXT_DONE', { detail: { tempId } }));
    })();
  `;
  document.head.appendChild(script);
  script.remove();

  await donePromise;
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

  const inputRect = promptInput.getBoundingClientRect();

  let parent = promptInput.parentElement;
  for (let depth = 0; parent && depth < 8; depth += 1) {
    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width < inputRect.width) {
      parent = parent.parentElement;
      continue;
    }

    const buttons = visibleElements(parent.querySelectorAll<HTMLElement>('button, [role="button"]'))
      .filter((button) => {
        const label = button.getAttribute("aria-label") ?? "";
        const title = button.getAttribute("title") ?? "";
        const text = button.textContent?.trim() ?? "";
        const combined = `${label} ${title} ${text}`.toLowerCase();

        if (/add|upload|media|attach|agent|settings|filter|tune|menu|back|project|home|collapse|trash|voice|mic/i.test(combined)) {
          return false;
        }
        if (text === "+" || text.toLowerCase() === "agent") return false;

        const rect = button.getBoundingClientRect();
        const isBelowOrRight = rect.bottom > inputRect.top - 10;
        const closeHorizontally = rect.left > inputRect.left - 50;
        
        // Relax size check to allow full-width buttons
        const isNotMassive = rect.width <= 400 && rect.height <= 120;

        return isBelowOrRight && closeHorizontally && isNotMassive;
      });

    if (buttons.length > 0) {
      const scored = buttons.map((button) => {
        const label = button.getAttribute("aria-label") ?? "";
        const title = button.getAttribute("title") ?? "";
        const text = button.textContent?.trim() ?? "";
        const combined = `${label} ${title} ${text}`.toLowerCase();

        let score = 0;
        if (/generate/i.test(combined)) score += 50;
        else if (/send/i.test(combined)) score += 40;
        else if (/submit/i.test(combined)) score += 40;
        else if (/run/i.test(combined)) score += 30;

        const rect = button.getBoundingClientRect();
        const distFromRight = parentRect.right - rect.right;
        const distFromBottom = parentRect.bottom - rect.bottom;
        const proximityBoost = Math.max(0, 10 - (distFromRight + distFromBottom) / 100);
        score += proximityBoost;

        return { button, score };
      });

      console.log(
        "Scene Flow candidate nearby buttons:",
        scored.map((s) => ({
          html: s.button.outerHTML,
          score: s.score,
          rect: { x: s.button.getBoundingClientRect().left, y: s.button.getBoundingClientRect().top, width: s.button.getBoundingClientRect().width, height: s.button.getBoundingClientRect().height }
        }))
      );

      return scored.sort((a, b) => b.score - a.score)[0]?.button ?? null;
    }

    parent = parent.parentElement;
  }

  return null;
}



// isPossibleSubmitButton has been integrated into findNearbyPromptButton and removed.

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

function isOriginalSizeOption(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const text = normalizedText(element);

  if (isDisabled(element)) return false;
  if (isInComposerArea(element) || isInsideNavigation(element)) return false;
  if (rect.width < 32 || rect.height < 18 || rect.width > 320 || rect.height > 120) return false;
  if (text.length > 90) return false;
  if (/upgrade|upscaled|2k|4k|trash|delete|rename|share|animate|prompt|cover|flag/i.test(text)) {
    return false;
  }

  return /\b(1k|1x)\b/i.test(text) || /original size/i.test(text);
}

function scoreOriginalSizeOption(element: HTMLElement): number {
  const text = normalizedText(element);
  let score = 0;
  if (/\b1k\b/i.test(text)) score += 4;
  if (/\b1x\b/i.test(text)) score += 4;
  if (/original size/i.test(text)) score += 3;
  if (element.getAttribute("role") === "menuitem" || element.getAttribute("role") === "option") {
    score += 2;
  }
  if (element instanceof HTMLButtonElement) score += 1;
  return score;
}

function normalizedText(element: HTMLElement): string {
  return [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-testid")
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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

function extractCssUrl(value: string): string | undefined {
  const match = /url\(["']?(.*?)["']?\)/.exec(value);
  return match?.[1];
}
