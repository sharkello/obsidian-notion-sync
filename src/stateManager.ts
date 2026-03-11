import type { Plugin } from "obsidian";
import type {
  PluginSettings,
  SyncState,
  SyncMapping,
  SyncLogEntry,
  DEFAULT_SETTINGS,
} from "./types";
import {
  DEFAULT_SYNC_STATE,
} from "./types";

/** Persisted data structure: settings + sync state */
interface PersistedData {
  settings: PluginSettings;
  syncState: SyncState;
}

/**
 * Manages persistent plugin state: file/folder mappings, sync timestamps,
 * and the sync log. All state is stored in data.json via the Obsidian API.
 */
export class StateManager {
  private plugin: Plugin;
  private state: SyncState;
  private log: SyncLogEntry[] = [];
  private maxLogEntries = 500;
  private dirty = false;

  constructor(plugin: Plugin, initialState?: SyncState) {
    this.plugin = plugin;
    this.state = initialState || { ...DEFAULT_SYNC_STATE };
  }

  // ── File Mappings ──────────────────────────────────────────

  /** Get the Notion page ID for an Obsidian file path */
  getFileMapping(filePath: string): SyncMapping | undefined {
    return this.state.fileMappings[filePath];
  }

  /** Store or update the mapping for a file */
  setFileMapping(filePath: string, mapping: SyncMapping): void {
    this.state.fileMappings[filePath] = mapping;
    this.dirty = true;
  }

  /** Remove a file mapping (e.g. after file deletion) */
  removeFileMapping(filePath: string): void {
    delete this.state.fileMappings[filePath];
    this.dirty = true;
  }

  /** Check if a file has been synced before */
  hasFileMapping(filePath: string): boolean {
    return filePath in this.state.fileMappings;
  }

  /** Get all file mappings */
  getAllFileMappings(): Record<string, SyncMapping> {
    return { ...this.state.fileMappings };
  }

  // ── Folder Mappings ────────────────────────────────────────

  /** Get the Notion page ID for an Obsidian folder path */
  getFolderMapping(folderPath: string): string | undefined {
    return this.state.folderMappings[folderPath];
  }

  /** Store a folder → Notion page ID mapping */
  setFolderMapping(folderPath: string, notionPageId: string): void {
    this.state.folderMappings[folderPath] = notionPageId;
    this.dirty = true;
  }

  /** Remove a folder mapping */
  removeFolderMapping(folderPath: string): void {
    delete this.state.folderMappings[folderPath];
    this.dirty = true;
  }

  /** Get all folder mappings */
  getAllFolderMappings(): Record<string, string> {
    return { ...this.state.folderMappings };
  }

  // ── Sync Timestamps ────────────────────────────────────────

  /** Record that a full sync was completed */
  setLastFullSync(timestamp: number): void {
    this.state.lastFullSync = timestamp;
    this.dirty = true;
  }

  get lastFullSync(): number {
    return this.state.lastFullSync;
  }

  // ── Change Detection ───────────────────────────────────────

  /** Check if a file needs syncing based on its content hash */
  needsSync(filePath: string, currentHash: string): boolean {
    const mapping = this.state.fileMappings[filePath];
    if (!mapping) return true;
    return mapping.lastSyncedHash !== currentHash;
  }

  // ── Sync Log ───────────────────────────────────────────────

  /** Add a log entry */
  addLog(level: SyncLogEntry["level"], message: string, filePath?: string): void {
    this.log.push({
      timestamp: Date.now(),
      level,
      message,
      filePath,
    });

    // Trim log if it exceeds max size
    if (this.log.length > this.maxLogEntries) {
      this.log = this.log.slice(-this.maxLogEntries);
    }
  }

  /** Get all log entries */
  getLogs(): SyncLogEntry[] {
    return [...this.log];
  }

  /** Clear the log */
  clearLogs(): void {
    this.log = [];
  }

  // ── Persistence ────────────────────────────────────────────

  /** Get the current sync state for saving */
  getState(): SyncState {
    return { ...this.state };
  }

  /** Replace the current state (used when loading from disk) */
  setState(state: SyncState): void {
    this.state = state;
    this.dirty = false;
  }

  /** Whether state has changed since last save */
  isDirty(): boolean {
    return this.dirty;
  }

  /** Mark state as clean (after saving) */
  markClean(): void {
    this.dirty = false;
  }

  // ── Utilities ──────────────────────────────────────────────

  /** Rename a file path in all mappings */
  renamePath(oldPath: string, newPath: string): void {
    if (this.state.fileMappings[oldPath]) {
      this.state.fileMappings[newPath] = this.state.fileMappings[oldPath];
      delete this.state.fileMappings[oldPath];
      this.dirty = true;
    }
    if (this.state.folderMappings[oldPath]) {
      this.state.folderMappings[newPath] = this.state.folderMappings[oldPath];
      delete this.state.folderMappings[oldPath];
      this.dirty = true;
    }
  }

  /** Count total synced files */
  get syncedFileCount(): number {
    return Object.keys(this.state.fileMappings).length;
  }

  /** Count total synced folders */
  get syncedFolderCount(): number {
    return Object.keys(this.state.folderMappings).length;
  }

  /** Reset all state (for full re-sync) */
  reset(): void {
    this.state = { ...DEFAULT_SYNC_STATE };
    this.dirty = true;
  }
}
