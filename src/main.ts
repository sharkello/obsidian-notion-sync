import { Plugin, TFile, Notice } from "obsidian";
import { NotionClient } from "./notionClient";
import { SyncEngine } from "./syncEngine";
import { StateManager } from "./stateManager";
import { NotionSyncSettingTab } from "./ui/settingsTab";
import { SyncLogModal } from "./ui/syncLogModal";
import {
  SyncMode,
  DEFAULT_SETTINGS,
  DEFAULT_SYNC_STATE,
} from "./types";
import type { PluginSettings, SyncState } from "./types";

/** Persisted data shape in data.json */
interface PersistedData {
  settings: PluginSettings;
  syncState: SyncState;
}

export default class NotionSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  stateManager: StateManager = new StateManager(this);
  private syncEngine!: SyncEngine;
  private scheduledInterval: number | null = null;
  private saveDebounce: number | null = null;

  async onload(): Promise<void> {
    await this.loadState();

    this.syncEngine = new SyncEngine(
      this.app,
      this.settings,
      this.stateManager
    );

    // Settings tab
    this.addSettingTab(new NotionSyncSettingTab(this.app, this));

    // Register commands
    this.addCommand({
      id: "sync-vault",
      name: "Sync entire vault to Notion",
      callback: () => this.syncFullVault(),
    });

    this.addCommand({
      id: "sync-current-file",
      name: "Sync current note to Notion",
      editorCallback: (_editor, ctx) => {
        const file = ctx.file;
        if (file) this.syncCurrentFile(file);
      },
    });

    this.addCommand({
      id: "sync-incremental",
      name: "Sync changed files to Notion",
      callback: () => this.syncIncremental(),
    });

    this.addCommand({
      id: "rebuild-hierarchy",
      name: "Rebuild Notion hierarchy",
      callback: () => this.rebuildHierarchy(),
    });

    this.addCommand({
      id: "open-sync-log",
      name: "Open sync log",
      callback: () => this.openSyncLog(),
    });

    // Configure auto-sync based on mode
    this.configureSyncMode();

    // Listen for file renames to update mappings
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.stateManager.renamePath(oldPath, file.path);
        this.debounceSaveState();
      })
    );

    // Listen for file deletions to cleanup mappings
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.stateManager.removeFileMapping(file.path);
        this.debounceSaveState();
      })
    );
  }

  onunload(): void {
    this.clearScheduledSync();
    this.syncEngine?.destroy();
  }

  // ── Public Methods (called by UI) ──────────────────────────

  /** Configure sync mode (called by settings tab) */
  configureSyncMode(): void {
    this.clearScheduledSync();

    switch (this.settings.syncMode) {
      case SyncMode.OnSave:
        this.registerEvent(
          this.app.vault.on("modify", (file) => {
            if (file instanceof TFile && file.extension === "md") {
              // Debounce: wait 2s after last save before syncing
              if (this.saveDebounce) window.clearTimeout(this.saveDebounce);
              this.saveDebounce = window.setTimeout(() => {
                this.syncCurrentFile(file);
              }, 2000);
            }
          })
        );
        break;

      case SyncMode.Scheduled:
        this.scheduledInterval = window.setInterval(
          () => this.syncIncremental(),
          this.settings.scheduledIntervalMinutes * 60 * 1000
        );
        this.registerInterval(this.scheduledInterval);
        break;
    }
  }

  /** Test connection to Notion */
  async testConnection(): Promise<boolean> {
    if (!this.settings.notionToken || !this.settings.rootPageId) {
      new Notice("Please fill in token and root page ID first");
      return false;
    }
    const client = new NotionClient(this.settings.notionToken);
    try {
      const ok = await client.testConnection(this.settings.rootPageId);
      new Notice(ok ? "Connection successful!" : "Connection failed: page not found or not shared with integration.");
      return ok;
    } catch (e: any) {
      new Notice(`Connection failed: ${e?.message || e}`);
      console.error("[NotionSync] testConnection error:", e);
      return false;
    } finally {
      client.destroy();
    }
  }

  /** Save settings and state to disk */
  async saveSettings(): Promise<void> {
    this.syncEngine?.updateSettings(this.settings);
    await this.saveState();
  }

  /** Save full state to data.json */
  async saveState(): Promise<void> {
    const data: PersistedData = {
      settings: this.settings,
      syncState: this.stateManager.getState(),
    };
    await this.saveData(data);
    this.stateManager.markClean();
  }

  // ── Private ────────────────────────────────────────────────

  private async loadState(): Promise<void> {
    const data: PersistedData | null = await this.loadData();
    if (data) {
      this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      this.stateManager.setState({
        ...DEFAULT_SYNC_STATE,
        ...data.syncState,
      });
    }
  }

  private async syncFullVault(): Promise<void> {
    const result = await this.syncEngine.syncFullVault();
    await this.saveState();
  }

  private async syncIncremental(): Promise<void> {
    const result = await this.syncEngine.syncIncremental();
    await this.saveState();
  }

  private async syncCurrentFile(file: TFile): Promise<void> {
    await this.syncEngine.syncCurrentFile(file);
    await this.saveState();
  }

  private async rebuildHierarchy(): Promise<void> {
    await this.syncEngine.rebuildHierarchy();
    await this.saveState();
  }

  private openSyncLog(): void {
    new SyncLogModal(this.app, this.stateManager.getLogs()).open();
  }

  private clearScheduledSync(): void {
    if (this.scheduledInterval !== null) {
      window.clearInterval(this.scheduledInterval);
      this.scheduledInterval = null;
    }
  }

  private debounceSaveState(): void {
    if (this.saveDebounce) window.clearTimeout(this.saveDebounce);
    this.saveDebounce = window.setTimeout(() => this.saveState(), 1000);
  }
}
