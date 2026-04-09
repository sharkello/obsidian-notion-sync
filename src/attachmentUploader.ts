import { requestUrl } from "obsidian";
import type { App, TFile } from "obsidian";
import type { NotionBlock, NotionBlockContent } from "./types";
import type { StateManager } from "./stateManager";

/** Supported image extensions */
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico",
]);

/** Supported file extensions for embeds */
const EMBED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  "pdf", "mp3", "mp4", "webm", "ogg", "wav",
]);

/**
 * Handles Obsidian attachment embeds (![[file.png]]) by:
 * 1. Reading the file from the vault
 * 2. Uploading to an external URL (if configured)
 * 3. Converting to Notion image/file blocks
 *
 * Without an upload endpoint, embeds become callout placeholders.
 */
export class AttachmentUploader {
  private app: App;
  private stateManager: StateManager;
  private uploadUrl: string;

  constructor(app: App, stateManager: StateManager, uploadUrl: string) {
    this.app = app;
    this.stateManager = stateManager;
    this.uploadUrl = uploadUrl;
  }

  /** Update the upload URL when settings change */
  setUploadUrl(url: string): void {
    this.uploadUrl = url;
  }

  /**
   * Process a markdown file's content and resolve attachment embeds.
   * Returns blocks with embeds resolved to image blocks where possible.
   */
  async processBlocks(
    blocks: NotionBlock[],
    sourceFilePath: string
  ): Promise<NotionBlock[]> {
    const processed: NotionBlock[] = [];

    for (const block of blocks) {
      // Check if this is an embed placeholder callout
      const calloutData = block.type === "callout" ? (block.callout as NotionBlockContent | undefined) : undefined;
      if (
        calloutData?.rich_text?.[0]?.text?.content?.startsWith("Embedded file: ")
      ) {
        const filename = (calloutData.rich_text)[0].text?.content.replace(
          "Embedded file: ",
          ""
        );
        const resolved = await this.resolveEmbed(filename, sourceFilePath);
        processed.push(resolved);
      } else {
        processed.push(block);
      }
    }

    return processed;
  }

  /**
   * Resolve a single embed reference to a Notion block.
   */
  private async resolveEmbed(
    filename: string,
    sourceFilePath: string
  ): Promise<NotionBlock> {
    // Find the file in the vault
    const file = this.findAttachment(filename, sourceFilePath);
    if (!file) {
      this.stateManager.addLog("warn", `Attachment not found: ${filename}`, sourceFilePath);
      return this.makePlaceholder(filename, "File not found in vault");
    }

    const ext = file.extension.toLowerCase();

    // For images, try to create an image block
    if (IMAGE_EXTENSIONS.has(ext)) {
      return this.handleImage(file);
    }

    // For PDFs and other files
    if (ext === "pdf") {
      return this.handlePdf(file);
    }

    // Unsupported embed type
    return this.makePlaceholder(filename, `Unsupported embed type: .${ext}`);
  }

  /**
   * Find an attachment file in the vault.
   * Obsidian resolves embeds relative to the source file and the vault's
   * attachment folder setting.
   */
  private findAttachment(filename: string, sourceFilePath: string): TFile | null {
    // Try resolving via Obsidian's link resolution
    const resolved = this.app.metadataCache.getFirstLinkpathDest(
      filename,
      sourceFilePath
    );

    if (resolved) return resolved;

    // Fallback: search by name across the vault
    const allFiles = this.app.vault.getFiles();
    return (
      allFiles.find(
        (f) => f.name === filename || f.path.endsWith(`/${filename}`)
      ) || null
    );
  }

  /**
   * Handle image embeds. If an upload URL is configured, upload the image
   * and return an external image block. Otherwise return a placeholder.
   */
  private async handleImage(file: TFile): Promise<NotionBlock> {
    if (this.uploadUrl) {
      try {
        const url = await this.uploadFile(file);
        return {
          type: "image",
          image: {
            type: "external",
            external: { url },
            caption: [
              { type: "text", text: { content: file.name } },
            ],
          },
        };
      } catch (error) {
        this.stateManager.addLog(
          "error",
          `Failed to upload ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
          file.path
        );
      }
    }

    return this.makePlaceholder(
      file.name,
      this.uploadUrl
        ? "Upload failed"
        : "Configure attachment upload URL in settings to sync images"
    );
  }

  /**
   * Handle PDF embeds similarly to images.
   */
  private async handlePdf(file: TFile): Promise<NotionBlock> {
    if (this.uploadUrl) {
      try {
        const url = await this.uploadFile(file);
        return {
          type: "pdf",
          pdf: {
            type: "external",
            external: { url },
            caption: [
              { type: "text", text: { content: file.name } },
            ],
          },
        };
      } catch (error) {
        this.stateManager.addLog(
          "error",
          `Failed to upload ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
          file.path
        );
      }
    }

    return this.makePlaceholder(file.name, "Configure upload URL for PDF embeds");
  }

  /**
   * Upload a file to the configured upload endpoint.
   * Expects a POST endpoint that accepts multipart/form-data
   * and returns JSON with { url: string }.
   */
  private async uploadFile(file: TFile): Promise<string> {
    const arrayBuffer = await this.app.vault.readBinary(file);
    const resp = await requestUrl({
      url: this.uploadUrl,
      method: "POST",
      contentType: "application/octet-stream",
      body: arrayBuffer,
      throw: false,
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`Upload failed: HTTP ${resp.status}`);
    }

    const data = resp.json as Record<string, unknown>;
    if (!data.url) {
      throw new Error("Upload response missing 'url' field");
    }

    return data.url as string;
  }

  /**
   * Create a callout block as a placeholder for unresolved embeds.
   */
  private makePlaceholder(filename: string, reason: string): NotionBlock {
    return {
      type: "callout",
      callout: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `\u{1F4CE} ${filename}\n${reason}`,
            },
          },
        ],
        icon: { type: "emoji", emoji: "\u{1F4CE}" },
        color: "gray_background",
      },
    };
  }

  /**
   * Check if a filename refers to an image.
   */
  static isImage(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return IMAGE_EXTENSIONS.has(ext);
  }

  /**
   * Check if a filename refers to a supported embed type.
   */
  static isEmbeddable(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return EMBED_EXTENSIONS.has(ext);
  }
}
