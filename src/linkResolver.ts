import type { App, TFile } from "obsidian";
import type { NotionBlock, NotionRichText } from "./types";
import type { StateManager } from "./stateManager";
import type { NotionClient } from "./notionClient";

/**
 * Resolves Obsidian internal [[wikilinks]] to Notion page URLs.
 * Runs as a second pass after all pages are created, so every
 * target page already has a known Notion page ID.
 */
export class LinkResolver {
  private app: App;
  private stateManager: StateManager;
  private notionClient: NotionClient;

  constructor(app: App, stateManager: StateManager, notionClient: NotionClient) {
    this.app = app;
    this.stateManager = stateManager;
    this.notionClient = notionClient;
  }

  /**
   * Scan a file's markdown for [[wikilinks]] and return a map
   * of link text → Notion page URL.
   */
  resolveLinks(content: string): Map<string, string> {
    const linkMap = new Map<string, string>();

    // Match [[target]] and [[target|alias]]
    const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;

    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const target = match[1].trim();
      const notionUrl = this.resolveTarget(target);
      if (notionUrl) {
        linkMap.set(target, notionUrl);
      }
    }

    return linkMap;
  }

  /**
   * Given a wikilink target string, find the corresponding Notion page URL.
   */
  private resolveTarget(target: string): string | null {
    // Strip heading anchors: [[Note#heading]] → [[Note]]
    const baseName = target.split("#")[0].trim();
    if (!baseName) return null;

    // Try to resolve via Obsidian's metadata cache
    const destFile = this.app.metadataCache.getFirstLinkpathDest(baseName, "");

    if (destFile) {
      const mapping = this.stateManager.getFileMapping(destFile.path);
      if (mapping) {
        return this.notionPageUrl(mapping.notionPageId);
      }
    }

    // Fallback: search file mappings by basename
    const allMappings = this.stateManager.getAllFileMappings();
    for (const [path, mapping] of Object.entries(allMappings)) {
      const pathBasename = path.replace(/\.md$/, "").split("/").pop();
      if (pathBasename === baseName) {
        return this.notionPageUrl(mapping.notionPageId);
      }
    }

    return null;
  }

  /**
   * Process Notion blocks to replace internal link placeholders
   * with actual Notion page links.
   */
  resolveBlockLinks(
    blocks: NotionBlock[],
    content: string
  ): NotionBlock[] {
    const linkMap = this.resolveLinks(content);
    if (linkMap.size === 0) return blocks;

    return blocks.map((block) => this.resolveBlockLinksRecursive(block, linkMap));
  }

  private resolveBlockLinksRecursive(
    block: NotionBlock,
    linkMap: Map<string, string>
  ): NotionBlock {
    const blockData = block[block.type];
    if (!blockData) return block;

    // Process rich_text arrays
    if (blockData.rich_text && Array.isArray(blockData.rich_text)) {
      blockData.rich_text = this.resolveRichTextLinks(
        blockData.rich_text,
        linkMap
      );
    }

    // Process children recursively
    if (blockData.children && Array.isArray(blockData.children)) {
      blockData.children = blockData.children.map((child: NotionBlock) =>
        this.resolveBlockLinksRecursive(child, linkMap)
      );
    }

    return block;
  }

  /**
   * In a rich_text array, find bold text that matches a link target
   * and convert it to a linked text segment.
   */
  private resolveRichTextLinks(
    richTexts: NotionRichText[],
    linkMap: Map<string, string>
  ): NotionRichText[] {
    return richTexts.map((rt) => {
      // Only process bold text that could be an internal link placeholder
      if (!rt.annotations?.bold) return rt;

      const content = rt.text.content;

      // Check if this bold text matches a link target or display text
      for (const [target, url] of linkMap.entries()) {
        if (content === target || content === target.split("/").pop()) {
          return {
            type: "text",
            text: {
              content: content,
              link: { url },
            },
            annotations: {
              ...rt.annotations,
              bold: false, // Remove the bold marker
            },
          };
        }
      }

      return rt;
    });
  }

  /**
   * Build a Notion page URL from a page ID.
   */
  private notionPageUrl(pageId: string): string {
    const cleanId = pageId.replace(/-/g, "");
    return `https://www.notion.so/${cleanId}`;
  }

  /**
   * Rebuild all links across the entire vault.
   * Call this after a full sync to ensure cross-references are correct.
   */
  async rebuildAllLinks(files: TFile[]): Promise<number> {
    let resolved = 0;

    for (const file of files) {
      const mapping = this.stateManager.getFileMapping(file.path);
      if (!mapping) continue;

      const content = await this.app.vault.cachedRead(file);
      const linkMap = this.resolveLinks(content);

      if (linkMap.size > 0) {
        resolved += linkMap.size;
      }
    }

    return resolved;
  }
}
