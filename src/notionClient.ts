import { requestUrl } from "obsidian";
import { RateLimiter } from "./rateLimiter";
import type { NotionBlock } from "./types";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const BLOCKS_PER_BATCH = 100;

/**
 * Wrapper around the Notion REST API using Obsidian's requestUrl.
 * Avoids the @notionhq/client SDK to prevent Electron/CORS issues.
 */
export class NotionClient {
  private token: string;
  private limiter: RateLimiter;

  constructor(token: string) {
    this.token = token;
    this.limiter = new RateLimiter(3);
  }

  updateToken(token: string): void {
    this.token = token;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    return this.limiter.schedule(async () => {
      const resp = await requestUrl({
        url: `${NOTION_API}${path}`,
        method,
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        throw: false,
      });

      if (resp.status === 429) {
        const retryAfter = (resp.headers["retry-after"] as string) || "1";
        const waitMs = parseFloat(retryAfter) * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
        return this.request(method, path, body);
      }

      let json: any;
      try {
        json = resp.json;
      } catch {
        throw new Error(`Notion API error ${resp.status}: ${resp.text}`);
      }

      if (resp.status < 200 || resp.status >= 300) {
        const msg = json?.message || resp.text || `HTTP ${resp.status}`;
        const err: any = new Error(`Notion API error: ${msg}`);
        err.status = resp.status;
        err.code = json?.code;
        throw err;
      }

      return json;
    });
  }

  /** Create a page under a parent page */
  async createPage(
    parentPageId: string,
    title: string,
    children: NotionBlock[] = [],
    properties?: Record<string, any>,
    icon?: string
  ): Promise<string> {
    const inlineChildren = children.slice(0, BLOCKS_PER_BATCH);
    const remainingChildren = children.slice(BLOCKS_PER_BATCH);

    const body: any = {
      parent: { type: "page_id", page_id: parentPageId },
      properties: {
        title: { title: [{ type: "text", text: { content: title } }] },
        ...properties,
      },
      children: inlineChildren,
    };

    if (icon) {
      body.icon = { type: "emoji", emoji: icon };
    }

    const response = await this.request("POST", "/pages", body);
    const pageId = response.id;

    if (remainingChildren.length > 0) {
      await this.appendBlocks(pageId, remainingChildren);
    }

    return pageId;
  }

  /** Append blocks to a page in batches of 100 */
  async appendBlocks(pageId: string, blocks: NotionBlock[]): Promise<void> {
    for (let i = 0; i < blocks.length; i += BLOCKS_PER_BATCH) {
      const batch = blocks.slice(i, i + BLOCKS_PER_BATCH);
      await this.request("PATCH", `/blocks/${pageId}/children`, {
        children: batch,
      });
    }
  }

  /** Delete all child blocks of a page */
  async clearPageContent(pageId: string): Promise<void> {
    const children = await this.listAllBlocks(pageId);
    for (const block of children) {
      await this.request("DELETE", `/blocks/${block.id}`);
    }
  }

  /** List all child blocks (handles pagination) */
  async listAllBlocks(
    pageId: string
  ): Promise<Array<{ id: string; type: string }>> {
    const blocks: Array<{ id: string; type: string }> = [];
    let cursor: string | undefined;

    do {
      const params = cursor
        ? `?start_cursor=${cursor}&page_size=100`
        : "?page_size=100";
      const response = await this.request(
        "GET",
        `/blocks/${pageId}/children${params}`
      );

      for (const block of response.results) {
        blocks.push({ id: block.id, type: block.type });
      }

      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return blocks;
  }

  /** Archive (soft-delete) a page */
  async archivePage(pageId: string): Promise<void> {
    await this.request("PATCH", `/pages/${pageId}`, { archived: true });
  }

  /** Update page properties */
  async updatePageProperties(
    pageId: string,
    properties: Record<string, any>
  ): Promise<void> {
    await this.request("PATCH", `/pages/${pageId}`, { properties });
  }

  /** Retrieve a page; returns null if not found */
  async getPage(pageId: string): Promise<any | null> {
    try {
      return await this.request("GET", `/pages/${pageId}`);
    } catch (error: any) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  /** Search for pages by title */
  async searchPages(query: string): Promise<any[]> {
    const response = await this.request("POST", "/search", {
      query,
      filter: { property: "object", value: "page" },
      page_size: 20,
    });
    return response.results;
  }

  /** Test connection by retrieving the root page */
  async testConnection(rootPageId: string): Promise<boolean> {
    const page = await this.getPage(rootPageId);
    return page !== null;
  }

  destroy(): void {
    this.limiter.clear();
  }
}
