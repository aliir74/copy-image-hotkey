import { Plugin, Notice, TFile } from "obsidian";

const IMAGE_EMBED_RE = /^!\[\[(.+?\.(png|jpg|jpeg|gif|bmp|tiff|webp|svg))\]\]$/i;
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|bmp|tiff|webp|svg)$/i;

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export default class CopyImageHotkeyPlugin extends Plugin {
  private selectedImg: HTMLImageElement | null = null;
  private cachedBlob: Blob | null = null;

  async onload(): Promise<void> {
    // Track clicks on images — preload blob immediately for instant copy
    this.registerDomEvent(document, "click", (evt: MouseEvent) => {
      const target = evt.target as HTMLElement;
      if (
        target instanceof HTMLImageElement &&
        this.isVaultImage(target)
      ) {
        this.selectedImg = target;
        this.cachedBlob = null;
        void this.preloadImageBlob(target);
      } else {
        this.selectedImg = null;
        this.cachedBlob = null;
      }
    });

    // Handle Cmd+C / Ctrl+C before the copy event for clicked images
    this.registerDomEvent(document, "keydown", (evt: KeyboardEvent) => {
      if ((evt.metaKey || evt.ctrlKey) && evt.key === "c") {
        this.handleKeyboardCopy(evt);
      }
    });

    // Handle copy event for text selections (source mode ![[image.png]])
    this.registerDomEvent(document, "copy", (evt: ClipboardEvent) => {
      this.handleCopyEvent(evt);
    });
  }

  isVaultImage(img: HTMLImageElement): boolean {
    const src = img.getAttribute("src") || "";
    // Obsidian vault images use app:// protocol or relative paths
    return src.startsWith("app://") || !src.startsWith("http");
  }

  handleKeyboardCopy(evt: KeyboardEvent): void {
    if (!this.selectedImg || !document.body.contains(this.selectedImg)) return;

    evt.preventDefault();

    // Use preloaded blob if ready (instant), otherwise fall back to vault read
    if (this.cachedBlob) {
      const blob = this.cachedBlob;
      navigator.clipboard
        .write([new ClipboardItem({ [blob.type]: blob })])
        .then(() => {
          new Notice("Image copied to clipboard!");
        })
        .catch((err: unknown) => {
          console.error("copy-image-hotkey:", err);
          new Notice("Failed to copy image: " + (err as Error).message);
        });
    } else {
      const filename = this.extractFilenameFromImg(this.selectedImg);
      if (!filename) return;
      const extMatch = filename.match(IMAGE_EXT_RE);
      if (!extMatch || !extMatch[1]) return;
      const mimeType = MIME_TYPES[extMatch[1].toLowerCase()];
      if (!mimeType) return;
      void this.copyImageToClipboard(filename, mimeType);
    }
  }

  handleCopyEvent(evt: ClipboardEvent): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // Strategy 1: Selected text matches ![[image.ext]] pattern (source mode)
    const text = selection.toString().trim();
    const match = text.match(IMAGE_EMBED_RE);
    if (match && match[1] && match[2]) {
      const ext = match[2].toLowerCase();
      const mimeType = MIME_TYPES[ext];
      if (!mimeType) return;
      evt.preventDefault();
      void this.copyImageToClipboard(match[1], mimeType);
      return;
    }

    // Strategy 2: Selection contains an <img> element (Live Preview widget)
    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();
    const img = fragment.querySelector("img");
    if (!img) return;

    const filename = this.extractFilenameFromImg(img);
    if (!filename) return;

    const extMatch = filename.match(IMAGE_EXT_RE);
    if (!extMatch || !extMatch[1]) return;

    const mimeType = MIME_TYPES[extMatch[1].toLowerCase()];
    if (!mimeType) return;

    evt.preventDefault();
    void this.copyImageToClipboard(filename, mimeType);
  }

  async preloadImageBlob(img: HTMLImageElement): Promise<void> {
    try {
      const src = img.getAttribute("src");
      if (!src) return;
      const resp = await fetch(src);
      this.cachedBlob = await resp.blob();
    } catch (e) {
      // Fall back to vault read on copy
      this.cachedBlob = null;
    }
  }

  extractFilenameFromImg(img: HTMLImageElement): string | null {
    // Try alt attribute first (most reliable in Obsidian)
    const alt = img.getAttribute("alt");
    if (alt && IMAGE_EXT_RE.test(alt)) return alt;

    // Try src — Obsidian uses app://local/<vault-path>/filename.ext
    const src = img.getAttribute("src");
    if (src) {
      try {
        const decoded = decodeURIComponent(src);
        const parts = decoded.split("/");
        const last = parts[parts.length - 1];
        if (!last) return null;
        const basename = last.split("?")[0];
        if (basename && IMAGE_EXT_RE.test(basename)) return basename;
      } catch (e) {
        // ignore decode errors
      }
    }

    return null;
  }

  async copyImageToClipboard(filename: string, mimeType: string): Promise<void> {
    try {
      const file = this.app.metadataCache.getFirstLinkpathDest(filename, "");
      if (!file || !(file instanceof TFile)) {
        new Notice("Image not found: " + filename);
        return;
      }

      const buffer = await this.app.vault.readBinary(file);

      if (mimeType === "image/svg+xml") {
        const text = new TextDecoder().decode(buffer);
        await navigator.clipboard.writeText(text);
        new Notice("SVG copied to clipboard!");
        return;
      }

      const blob = new Blob([buffer], { type: mimeType });
      await navigator.clipboard.write([
        new ClipboardItem({ [mimeType]: blob }),
      ]);
      new Notice("Image copied to clipboard!");
    } catch (err: unknown) {
      console.error("copy-image-hotkey:", err);
      new Notice("Failed to copy image: " + (err as Error).message);
    }
  }
}
