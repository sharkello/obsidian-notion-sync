import { App, Modal } from "obsidian";
import type { SyncLogEntry } from "../types";

/**
 * Modal that displays the sync log with filtering and auto-scroll.
 */
export class SyncLogModal extends Modal {
  private logs: SyncLogEntry[];
  private filter: "all" | "info" | "warn" | "error" = "all";

  constructor(app: App, logs: SyncLogEntry[]) {
    super(app);
    this.logs = logs;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("notion-sync-log-modal");

    // Header
    contentEl.createEl("h2", { text: "Sync Log" });

    // Filter bar
    const filterBar = contentEl.createDiv({ cls: "sync-log-filter" });
    this.createFilterButton(filterBar, "All", "all");
    this.createFilterButton(filterBar, "Info", "info");
    this.createFilterButton(filterBar, "Warnings", "warn");
    this.createFilterButton(filterBar, "Errors", "error");

    // Log container
    const logContainer = contentEl.createDiv({ cls: "sync-log-entries" });
    logContainer.style.maxHeight = "400px";
    logContainer.style.overflowY = "auto";
    logContainer.style.fontFamily = "monospace";
    logContainer.style.fontSize = "12px";
    logContainer.style.padding = "8px";
    logContainer.style.border = "1px solid var(--background-modifier-border)";
    logContainer.style.borderRadius = "4px";
    logContainer.style.marginTop = "8px";

    this.renderLogs(logContainer);

    // Scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;

    // Stats
    const statsEl = contentEl.createDiv({ cls: "sync-log-stats" });
    statsEl.style.marginTop = "8px";
    statsEl.style.fontSize = "12px";
    statsEl.style.color = "var(--text-muted)";

    const infos = this.logs.filter((l) => l.level === "info").length;
    const warns = this.logs.filter((l) => l.level === "warn").length;
    const errors = this.logs.filter((l) => l.level === "error").length;
    statsEl.textContent = `Total: ${this.logs.length} entries | ${infos} info, ${warns} warnings, ${errors} errors`;
  }

  private createFilterButton(
    container: HTMLElement,
    label: string,
    filter: typeof this.filter
  ): void {
    const btn = container.createEl("button", { text: label });
    btn.style.marginRight = "4px";
    btn.style.padding = "2px 8px";
    btn.style.fontSize = "12px";

    if (this.filter === filter) {
      btn.style.fontWeight = "bold";
    }

    btn.addEventListener("click", () => {
      this.filter = filter;
      this.onOpen(); // Re-render
    });
  }

  private renderLogs(container: HTMLElement): void {
    const filtered =
      this.filter === "all"
        ? this.logs
        : this.logs.filter((l) => l.level === this.filter);

    if (filtered.length === 0) {
      container.createEl("p", {
        text: "No log entries.",
        cls: "sync-log-empty",
      });
      return;
    }

    for (const entry of filtered) {
      const row = container.createDiv({ cls: `sync-log-entry sync-log-${entry.level}` });
      row.style.padding = "2px 0";
      row.style.borderBottom = "1px solid var(--background-modifier-border-hover)";

      const time = new Date(entry.timestamp).toLocaleTimeString();

      const levelColors: Record<string, string> = {
        info: "var(--text-muted)",
        warn: "var(--text-accent)",
        error: "var(--text-error)",
      };

      const levelEl = row.createSpan({ text: `[${time}] ` });
      levelEl.style.color = "var(--text-muted)";

      const tagEl = row.createSpan({ text: `[${entry.level.toUpperCase()}] ` });
      tagEl.style.color = levelColors[entry.level] || "var(--text-normal)";
      tagEl.style.fontWeight = "bold";

      row.createSpan({ text: entry.message });

      if (entry.filePath) {
        const pathEl = row.createSpan({ text: ` (${entry.filePath})` });
        pathEl.style.color = "var(--text-muted)";
        pathEl.style.fontSize = "11px";
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
