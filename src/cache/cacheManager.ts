import crypto from "crypto";
import type { ComponentCatalog, ComponentProps, Component } from "../types.js";

/**
 * Cache Manager
 * In-memory cache with indexing for O(1) lookups and content-hash invalidation
 */
export class CacheManager {
  private catalogCache: ComponentCatalog | null = null;
  private propCache: Map<
    string,
    { hash: string; props: ComponentProps | null }
  > = new Map();

  // Indexes for O(1) lookups (rebuilt on catalog change)
  private nameIndex: Map<string, Component[]> = new Map();
  private layerIndex: Map<string, Component[]> = new Map();
  private importIndex: Map<string, Component[]> = new Map();
  private childIndex: Map<string, Component[]> = new Map();

  /**
   * Get cached catalog
   */
  getCatalog(): ComponentCatalog | null {
    return this.catalogCache;
  }

  /**
   * Set catalog cache and rebuild indexes
   */
  setCatalog(catalog: ComponentCatalog): void {
    this.catalogCache = catalog;
    this.rebuildIndexes(catalog);
  }

  /**
   * Invalidate catalog cache and indexes
   */
  invalidateCatalog(): void {
    this.catalogCache = null;
    this.clearIndexes();
  }

  /**
   * O(1) lookup by component name (case-insensitive)
   */
  getByName(name: string): Component[] {
    return this.nameIndex.get(name.toLowerCase()) || [];
  }

  /**
   * O(1) lookup by architecture layer
   */
  getByLayer(layer: string): Component[] {
    return this.layerIndex.get(layer) || [];
  }

  /**
   * O(1) lookup: find all components that import a given name
   */
  getImportersOf(name: string): Component[] {
    return this.importIndex.get(name.toLowerCase()) || [];
  }

  /**
   * O(1) lookup: find all components that render a given child
   */
  getRenderersOf(name: string): Component[] {
    return this.childIndex.get(name.toLowerCase()) || [];
  }

  /**
   * Get cached props for a file
   */
  async getProps(
    filePath: string,
    content: string
  ): Promise<ComponentProps | null | undefined> {
    const hash = this.hashContent(content);
    const cached = this.propCache.get(filePath);

    if (cached && cached.hash === hash) {
      return cached.props;
    }

    return undefined; // Cache miss
  }

  /**
   * Set props cache for a file
   */
  setProps(
    filePath: string,
    content: string,
    props: ComponentProps | null
  ): void {
    const hash = this.hashContent(content);
    this.propCache.set(filePath, { hash, props });
  }

  /**
   * Invalidate props cache for a file
   */
  invalidateProps(filePath: string): void {
    this.propCache.delete(filePath);
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.catalogCache = null;
    this.propCache.clear();
    this.clearIndexes();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    catalogCached: boolean;
    propsCacheSize: number;
    indexSizes: {
      name: number;
      layer: number;
      import: number;
      child: number;
    };
  } {
    return {
      catalogCached: this.catalogCache !== null,
      propsCacheSize: this.propCache.size,
      indexSizes: {
        name: this.nameIndex.size,
        layer: this.layerIndex.size,
        import: this.importIndex.size,
        child: this.childIndex.size,
      },
    };
  }

  /**
   * Rebuild all indexes from catalog
   */
  private addToIndex(index: Map<string, Component[]>, key: string, component: Component): void {
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key)!.push(component);
  }

  private clearIndexes(): void {
    this.nameIndex.clear();
    this.layerIndex.clear();
    this.importIndex.clear();
    this.childIndex.clear();
  }

  private rebuildIndexes(catalog: ComponentCatalog): void {
    this.clearIndexes();

    for (const component of catalog.components) {
      this.addToIndex(this.nameIndex, component.name.toLowerCase(), component);
      // Also index by fileAlias (when defineComponent name differs from filename)
      if (component.fileAlias) {
        this.addToIndex(this.nameIndex, component.fileAlias.toLowerCase(), component);
      }
      this.addToIndex(this.layerIndex, component.architectureLayer, component);

      const importedNames = (component.imports || []).flatMap((imp) => imp.names);
      for (const name of importedNames) {
        this.addToIndex(this.importIndex, name.toLowerCase(), component);
      }

      for (const child of component.childComponents || []) {
        this.addToIndex(this.childIndex, child.toLowerCase(), component);
      }
    }
  }

  /**
   * Hash file content for cache key
   */
  private hashContent(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }
}
