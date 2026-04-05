/** Sync mode configuration */
export enum SyncMode {
  Manual = "manual",
  CurrentFile = "current_file",
  OnSave = "on_save",
  Scheduled = "scheduled",
}

/** Plugin settings stored in data.json */
export interface PluginSettings {
  notionToken: string;
  rootPageId: string;
  syncMode: SyncMode;
  syncAttachments: boolean;
  syncMetadata: boolean;
  scheduledIntervalMinutes: number;
  /** Optional external upload URL for attachments */
  attachmentUploadUrl: string;
  /** Download Notion images to local vault on pull */
  downloadImages: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  notionToken: "",
  rootPageId: "",
  syncMode: SyncMode.Manual,
  syncAttachments: true,
  syncMetadata: true,
  scheduledIntervalMinutes: 30,
  attachmentUploadUrl: "",
  downloadImages: true,
};

/** Mapping entry for a single synced file */
export interface SyncMapping {
  notionPageId: string;
  lastSyncedHash: string;
  lastSyncedAt: number;
}

/** Full plugin persistent state */
export interface SyncState {
  /** obsidian file path -> sync mapping */
  fileMappings: Record<string, SyncMapping>;
  /** obsidian folder path -> notion page id */
  folderMappings: Record<string, string>;
  /** last full sync timestamp */
  lastFullSync: number;
}

export const DEFAULT_SYNC_STATE: SyncState = {
  fileMappings: {},
  folderMappings: {},
  lastFullSync: 0,
};

/** Log entry for sync operations */
export interface SyncLogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
  filePath?: string;
}

/** Notion rich text object */
export interface NotionRichText {
  type: "text";
  text: {
    content: string;
    link?: { url: string } | null;
  };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
}

/** Notion block object for creation */
export interface NotionBlock {
  type: string;
  [key: string]: any;
}

// ── Sync History ───────────────────────────────────────────

export interface SyncHistoryEntry {
  id: string;           // unique id (timestamp + random)
  timestamp: number;
  operation: "push" | "pull" | "pull-new";
  filePath: string;
  fileName: string;
  snapshot?: string;    // previous file content (for rollback), only for pull
}

export interface SyncHistory {
  entries: SyncHistoryEntry[];
}

export const DEFAULT_SYNC_HISTORY: SyncHistory = { entries: [] };
