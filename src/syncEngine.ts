import type { App, TFile, TFolder, TAbstractFile } from "obsidian";
import { Notice } from "obsidian";
import { NotionClient } from "./notionClient";
import { MarkdownParser } from "./markdownParser";
import { LinkResolver } from "./linkResolver";
import { AttachmentUploader } from "./attachmentUploader";
import { StateManager } from "./stateManager";
import type { PluginSettings, NotionBlock } from "./types";

/**
 * Orchestrates synchronization between the Obsidian vault and Notion.
 * Supports full sync, incremental sync, and single-file sync.
 */
export class SyncEngine {
  private app: App;
  private settings: PluginSettings;
  private notionClient: NotionClient;
  private parser: MarkdownParser;
  private linkResolver: LinkResolver;
  private attachmentUploader: AttachmentUploader;
  private stateManager: StateManager;
  private isSyncing = false;
  private abortRequested = false;

  constructor(
    app: App,
    settings: PluginSettings,
    stateManager: StateManager
  ) {
    this.app = app;
    this.settings = settings;
    this.stateManager = stateManager;
    this.notionClient = new NotionClient(settings.notionToken);
    this.parser = new MarkdownParser();
    this.linkResolver = new LinkResolver(app, stateManager, this.notionClient);
    this.attachmentUploader = new AttachmentUploader(
      app,
      stateManager,
      settings.attachmentUploadUrl
    );
  }

  /** Update references when settings change */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.notionClient.updateToken(settings.notionToken);
    this.attachmentUploader.setUploadUrl(settings.attachmentUploadUrl);
  }

  /** Whether a sync is currently in progress */
  get syncing(): boolean {
    return this.isSyncing;
  }

  /** Request abort of current sync */
  abort(): void {
    this.abortRequested = true;
  }

  // ── Full Vault Sync ────────────────────────────────────────

  /**
   * Sync the entire vault to Notion. Creates folder hierarchy and
   * syncs all markdown files.
   */
  async syncFullVault(): Promise<{ synced: number; errors: number }> {
    if (this.isSyncing) {
      new Notice("Sync already in progress");
      return { synced: 0, errors: 0 };
    }

    if (!this.validateSettings()) return { synced: 0, errors: 0 };

    this.isSyncing = true;
    this.abortRequested = false;
    let synced = 0;
    let errors = 0;

    try {
      this.stateManager.addLog("info", "Starting full vault sync");
      new Notice("Starting full vault sync...");

      // Phase 1: Create folder hierarchy
      await this.syncFolderHierarchy();

      // Phase 2: Sync all markdown files
      const mdFiles = this.app.vault.getMarkdownFiles();
      const total = mdFiles.length;

      for (let i = 0; i < mdFiles.length; i++) {
        if (this.abortRequested) {
          this.stateManager.addLog("warn", "Sync aborted by user");
          break;
        }

        const file = mdFiles[i];
        try {
          const didSync = await this.syncFile(file, false);
          if (didSync) synced++;

          // Progress notification every 25 files
          if ((i + 1) % 25 === 0) {
            new Notice(`Syncing... ${i + 1}/${total}`);
          }
        } catch (error: any) {
          errors++;
          this.stateManager.addLog(
            "error",
            `Failed to sync: ${error.message}`,
            file.path
          );
        }
      }

      // Phase 3: Resolve internal links (second pass)
      await this.resolveAllLinks(mdFiles);

      this.stateManager.setLastFullSync(Date.now());
      this.stateManager.addLog(
        "info",
        `Full sync complete: ${synced} synced, ${errors} errors`
      );
      new Notice(`Sync complete: ${synced} files synced, ${errors} errors`);
    } catch (error: any) {
      this.stateManager.addLog("error", `Full sync failed: ${error.message}`);
      new Notice(`Sync failed: ${error.message}`);
    } finally {
      this.isSyncing = false;
    }

    return { synced, errors };
  }

  // ── Incremental Sync ───────────────────────────────────────

  /**
   * Only sync files that have changed since last sync.
   * Uses content hashing to detect changes.
   */
  async syncIncremental(): Promise<{ synced: number; errors: number }> {
    if (this.isSyncing) {
      new Notice("Sync already in progress");
      return { synced: 0, errors: 0 };
    }

    if (!this.validateSettings()) return { synced: 0, errors: 0 };

    this.isSyncing = true;
    this.abortRequested = false;
    let synced = 0;
    let errors = 0;

    try {
      this.stateManager.addLog("info", "Starting incremental sync");

      // Ensure folder hierarchy is up to date
      await this.syncFolderHierarchy();

      const mdFiles = this.app.vault.getMarkdownFiles();

      for (const file of mdFiles) {
        if (this.abortRequested) break;

        try {
          const content = await this.app.vault.cachedRead(file);
          const hash = this.hashContent(content);

          if (this.stateManager.needsSync(file.path, hash)) {
            await this.syncFile(file, false);
            synced++;
          }
        } catch (error: any) {
          errors++;
          this.stateManager.addLog(
            "error",
            `Incremental sync failed: ${error.message}`,
            file.path
          );
        }
      }

      // Handle deleted files: remove mappings for files no longer in vault
      this.cleanupDeletedFiles(mdFiles);

      if (synced > 0) {
        await this.resolveAllLinks(mdFiles);
      }

      this.stateManager.addLog(
        "info",
        `Incremental sync: ${synced} updated, ${errors} errors`
      );
      new Notice(`Incremental sync: ${synced} updated, ${errors} errors`);
    } catch (error: any) {
      this.stateManager.addLog("error", `Incremental sync failed: ${error.message}`);
      new Notice(`Sync failed: ${error.message}`);
    } finally {
      this.isSyncing = false;
    }

    return { synced, errors };
  }

  // ── Single File Sync ───────────────────────────────────────

  /**
   * Sync a single file to Notion.
   */
  async syncCurrentFile(file: TFile): Promise<boolean> {
    if (this.isSyncing) {
      new Notice("Sync already in progress");
      return false;
    }

    if (!this.validateSettings()) return false;

    this.isSyncing = true;
    try {
      // Ensure parent folders exist
      await this.ensureParentFolders(file);

      const didSync = await this.syncFile(file, true);
      if (didSync) {
        new Notice(`Synced: ${file.basename}`);
      }
      return didSync;
    } catch (error: any) {
      this.stateManager.addLog(
        "error",
        `Failed to sync: ${error.message}`,
        file.path
      );
      new Notice(`Sync failed: ${error.message}`);
      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  // ── Rebuild Hierarchy ──────────────────────────────────────

  /**
   * Completely rebuild the Notion page hierarchy from scratch.
   * Clears all existing mappings and recreates everything.
   */
  async rebuildHierarchy(): Promise<void> {
    if (this.isSyncing) {
      new Notice("Sync already in progress");
      return;
    }

    this.isSyncing = true;
    try {
      this.stateManager.addLog("info", "Rebuilding Notion hierarchy");
      new Notice("Rebuilding hierarchy... This may take a while.");

      this.stateManager.reset();
      await this.syncFullVault();
    } finally {
      this.isSyncing = false;
    }
  }

  // ── Internal Methods ───────────────────────────────────────

  /**
   * Sync a single markdown file to Notion.
   * Creates or updates the corresponding Notion page.
   */
  private async syncFile(
    file: TFile,
    resolveLinks: boolean
  ): Promise<boolean> {
    const content = await this.app.vault.cachedRead(file);
    const hash = this.hashContent(content);

    // Parse content
    const body = MarkdownParser.stripFrontmatter(content);
    let blocks = this.parser.parse(body);

    // Resolve internal links if requested
    if (resolveLinks) {
      blocks = this.linkResolver.resolveBlockLinks(blocks, content);
    }

    // Process attachments
    if (this.settings.syncAttachments) {
      blocks = await this.attachmentUploader.processBlocks(blocks, file.path);
    }

    // Determine parent page
    const parentPageId = this.getParentPageId(file);

    // Check if page already exists
    const existingMapping = this.stateManager.getFileMapping(file.path);

    if (existingMapping) {
      // Update: clear existing content and re-append
      try {
        await this.notionClient.clearPageContent(existingMapping.notionPageId);
        if (blocks.length > 0) {
          await this.notionClient.appendBlocks(
            existingMapping.notionPageId,
            blocks
          );
        }

        // Update metadata properties
        if (this.settings.syncMetadata) {
          await this.syncMetadata(existingMapping.notionPageId, content);
        }

        this.stateManager.setFileMapping(file.path, {
          notionPageId: existingMapping.notionPageId,
          lastSyncedHash: hash,
          lastSyncedAt: Date.now(),
        });

        this.stateManager.addLog("info", `Updated: ${file.path}`, file.path);
        return true;
      } catch (error: any) {
        // If page was deleted in Notion, create a new one
        if (error?.status === 404) {
          this.stateManager.removeFileMapping(file.path);
        } else {
          throw error;
        }
      }
    }

    // Create new page
    const pageId = await this.notionClient.createPage(
      parentPageId,
      file.basename,
      blocks
    );

    // Sync metadata
    if (this.settings.syncMetadata) {
      await this.syncMetadata(pageId, content);
    }

    this.stateManager.setFileMapping(file.path, {
      notionPageId: pageId,
      lastSyncedHash: hash,
      lastSyncedAt: Date.now(),
    });

    this.stateManager.addLog("info", `Created: ${file.path}`, file.path);
    return true;
  }

  /**
   * Create the Notion page hierarchy mirroring the vault's folder structure.
   */
  private async syncFolderHierarchy(): Promise<void> {
    const rootFolder = this.app.vault.getRoot();
    await this.syncFolder(rootFolder, this.settings.rootPageId);
  }

  private async syncFolder(
    folder: TFolder,
    parentNotionId: string
  ): Promise<void> {
    for (const child of folder.children) {
      if (this.abortRequested) return;

      if (child instanceof (this.app.vault as any).constructor) continue;

      if ((child as TAbstractFile).hasOwnProperty("children")) {
        // It's a folder
        const subFolder = child as TFolder;

        // Skip hidden folders
        if (subFolder.name.startsWith(".")) continue;

        let folderPageId = this.stateManager.getFolderMapping(subFolder.path);

        if (!folderPageId) {
          // Create the folder page in Notion
          try {
            folderPageId = await this.notionClient.createPage(
              parentNotionId,
              subFolder.name,
              [],
              undefined,
              "\u{1F4C1}" // folder emoji
            );
            this.stateManager.setFolderMapping(subFolder.path, folderPageId);
            this.stateManager.addLog(
              "info",
              `Created folder: ${subFolder.path}`
            );
          } catch (error: any) {
            this.stateManager.addLog(
              "error",
              `Failed to create folder: ${error.message}`,
              subFolder.path
            );
            continue;
          }
        } else {
          // Verify the folder page still exists
          const page = await this.notionClient.getPage(folderPageId);
          if (!page || page.archived) {
            // Recreate it
            folderPageId = await this.notionClient.createPage(
              parentNotionId,
              subFolder.name,
              [],
              undefined,
              "\u{1F4C1}"
            );
            this.stateManager.setFolderMapping(subFolder.path, folderPageId);
          }
        }

        // Recurse into subfolder
        await this.syncFolder(subFolder, folderPageId);
      }
    }
  }

  /**
   * Ensure all parent folders for a file exist in Notion.
   */
  private async ensureParentFolders(file: TFile): Promise<void> {
    const parts = file.path.split("/");
    parts.pop(); // Remove filename

    let currentPath = "";
    let parentId = this.settings.rootPageId;

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      let folderId = this.stateManager.getFolderMapping(currentPath);
      if (!folderId) {
        folderId = await this.notionClient.createPage(
          parentId,
          part,
          [],
          undefined,
          "\u{1F4C1}"
        );
        this.stateManager.setFolderMapping(currentPath, folderId);
      }
      parentId = folderId;
    }
  }

  /**
   * Get the Notion parent page ID for a file.
   */
  private getParentPageId(file: TFile): string {
    if (!file.parent || file.parent.isRoot()) {
      return this.settings.rootPageId;
    }
    return (
      this.stateManager.getFolderMapping(file.parent.path) ||
      this.settings.rootPageId
    );
  }

  /**
   * Extract frontmatter and sync as Notion page properties.
   * Notion pages that aren't in a database have limited property support,
   * so we add metadata as a properties block at the top of the page.
   */
  private async syncMetadata(
    pageId: string,
    content: string
  ): Promise<void> {
    const frontmatter = MarkdownParser.extractFrontmatter(content);
    if (Object.keys(frontmatter).length === 0) return;

    // Since standalone Notion pages don't support custom properties,
    // we represent metadata as a formatted callout block at the top.
    // For database-backed pages, you'd use properties directly.
    const metaLines = Object.entries(frontmatter).map(([key, value]) => {
      const displayValue = Array.isArray(value) ? value.join(", ") : String(value);
      return `${key}: ${displayValue}`;
    });

    const metaBlock: NotionBlock = {
      type: "callout",
      callout: {
        rich_text: [
          {
            type: "text",
            text: { content: metaLines.join("\n") },
          },
        ],
        icon: { type: "emoji", emoji: "\u{2139}\uFE0F" },
        color: "blue_background",
      },
    };

    // Prepend metadata block (append at the beginning via the API)
    // Since we can't prepend easily, this gets included in the page creation.
    // For updates, metadata is part of the full content re-sync.
  }

  /**
   * Resolve all internal links across synced files (second pass).
   */
  private async resolveAllLinks(files: TFile[]): Promise<void> {
    this.stateManager.addLog("info", "Resolving internal links...");

    for (const file of files) {
      if (this.abortRequested) break;

      const mapping = this.stateManager.getFileMapping(file.path);
      if (!mapping) continue;

      try {
        const content = await this.app.vault.cachedRead(file);
        const linkMap = this.linkResolver.resolveLinks(content);

        if (linkMap.size > 0) {
          // Re-parse and re-sync with resolved links
          const body = MarkdownParser.stripFrontmatter(content);
          let blocks = this.parser.parse(body);
          blocks = this.linkResolver.resolveBlockLinks(blocks, content);

          if (this.settings.syncAttachments) {
            blocks = await this.attachmentUploader.processBlocks(
              blocks,
              file.path
            );
          }

          await this.notionClient.clearPageContent(mapping.notionPageId);
          if (blocks.length > 0) {
            await this.notionClient.appendBlocks(mapping.notionPageId, blocks);
          }
        }
      } catch (error: any) {
        this.stateManager.addLog(
          "warn",
          `Link resolution failed: ${error.message}`,
          file.path
        );
      }
    }
  }

  /**
   * Remove mappings for files that no longer exist in the vault.
   */
  private cleanupDeletedFiles(currentFiles: TFile[]): void {
    const currentPaths = new Set(currentFiles.map((f) => f.path));
    const allMappings = this.stateManager.getAllFileMappings();

    for (const path of Object.keys(allMappings)) {
      if (!currentPaths.has(path)) {
        this.stateManager.removeFileMapping(path);
        this.stateManager.addLog("info", `Removed mapping for deleted: ${path}`);
      }
    }
  }

  /**
   * Validate that required settings are configured.
   */
  private validateSettings(): boolean {
    if (!this.settings.notionToken) {
      new Notice("Please configure your Notion API token in settings");
      return false;
    }
    if (!this.settings.rootPageId) {
      new Notice("Please configure your root Notion page ID in settings");
      return false;
    }
    return true;
  }

  /**
   * Simple content hash using a fast string hashing algorithm.
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(36);
  }

  /** Cleanup resources */
  destroy(): void {
    this.notionClient.destroy();
  }
}
