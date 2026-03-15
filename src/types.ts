/**
 * Architectural layer type for scanned items
 */
export type ArchitectureLayer =
  | "component"
  | "page"
  | "hook"
  | "service"
  | "adapter"
  | "context"
  | "dto"
  | "type";

/**
 * Configuration file schema (.component-intelligence.json)
 */
export interface ProjectConfig {
  scanTargets?: ScanTarget[];
  routeFiles?: string[];
  aliases?: Record<string, string>;
  exclude?: string[];
  phiCompliance?: {
    enabled?: boolean;
    additionalPatterns?: string[];
  };
}

/**
 * Scan target configuration
 */
export interface ScanTarget {
  dir: string; // Relative to workspace root (e.g., "src/components")
  extensions: string[]; // File extensions to include (e.g., [".tsx"])
  type: ArchitectureLayer;
}

/**
 * Accessibility metadata
 */
export interface AccessibilityInfo {
  ariaAttributes: string[];
  roles: string[];
  semanticElements: string[];
  keyboardHandlers: string[];
  hasTestId: boolean;
  hasScreenReaderSupport: boolean;
}

/**
 * Import information - ENHANCED
 */
export interface ImportInfo {
  type: "named" | "default" | "namespace";
  names: string[]; // Imported names
  source: string; // Original import path
  resolvedPath?: string; // Absolute file path (if resolvable)
}

/**
 * Component metadata structure - ENHANCED
 */
export interface Component {
  name: string;
  path: string;
  category: string;
  relativePath: string;
  lastModified: number;
  architectureLayer: ArchitectureLayer; // Which layer this belongs to
  line?: number;
  exportType?: "named" | "default" | "none";
  description?: string;
  hooks?: string[];
  stateVariables?: string[];
  accessibility?: AccessibilityInfo;

  // Epic 001 enhancements
  childComponents?: string[]; // PascalCase JSX elements rendered
  eventHandlers?: string[]; // onClick, onSubmit, etc.
  imports?: ImportInfo[]; // Import statements
  dataFetchingPattern?: string; // "react-query" | "swr" | "useEffect-fetch" | etc.

  // Vue-specific metadata
  emits?: string[]; // Emitted event names (Vue defineEmits / Options API emits)
  vModelBindings?: string[]; // v-model bindings (e.g., ["modelValue", "search", "filters"])

  // Hook-specific metadata
  parameters?: string[]; // Function parameters for hooks
  returnType?: string; // Return type for hooks
  queryKeys?: string[]; // React Query keys used
  adapterCalls?: string[]; // Adapter/service functions called
  phiCompliance?: PhiComplianceInfo; // PHI compliance status

  // Service/adapter-specific metadata
  apiEndpoints?: string[]; // API endpoints called
  hasMockImplementation?: boolean; // Uses mock/real adapter pattern
  dtosUsed?: string[]; // DTOs referenced

  // Route metadata (for pages)
  routePath?: string; // URL route path
  isProtected?: boolean; // Requires authentication

  // File alias (when defineComponent name differs from filename)
  fileAlias?: string;
}

/**
 * PHI compliance information
 */
export interface PhiComplianceInfo {
  hasZeroCacheTime: boolean; // gcTime: 0
  hasZeroStaleTime: boolean; // staleTime: 0
  hasConsoleLogNearPhi: boolean; // console.log near patient data
  hasLocalStorageUsage: boolean; // localStorage usage
  hasSessionStorageUsage: boolean; // sessionStorage usage
  violations: string[]; // Human-readable violation descriptions
}

/**
 * Route mapping entry
 */
export interface RouteEntry {
  path: string;
  component: string;
  isProtected: boolean;
  parentLayout?: string;
  children?: RouteEntry[];
  isDynamic: boolean;
  dynamicSegments?: string[];
}

/**
 * Dead code detection result
 */
export interface DeadCodeEntry {
  name: string;
  relativePath: string;
  architectureLayer: ArchitectureLayer;
  exportType: "named" | "default" | "none";
  reason: string;
}

/**
 * Component catalog organized by category
 */
export interface ComponentCatalog {
  components: Component[];
  categories: Record<string, Component[]>;
  totalCount: number;
  lastScanned: number;
  routes?: RouteEntry[];
}

/**
 * Prop metadata
 */
export interface PropInfo {
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: string;
}

/**
 * Component props result
 */
export interface ComponentProps {
  componentName: string;
  propsInterfaceName?: string;
  props: Record<string, PropInfo>;
  extendsTypes?: string[];
}

/**
 * Component analysis result
 */
export interface ComponentAnalysis {
  line?: number;
  exportType?: "named" | "default" | "none";
  description?: string;
  hooks?: string[];
  stateVariables?: string[];
  accessibility?: AccessibilityInfo;
  childComponents?: string[];
  eventHandlers?: string[];
  imports?: ImportInfo[];
  dataFetchingPattern?: string;
  emits?: string[];
  vModelBindings?: string[];
  parameters?: string[];
  returnType?: string;
  queryKeys?: string[];
  adapterCalls?: string[];
  phiCompliance?: PhiComplianceInfo;
  apiEndpoints?: string[];
  hasMockImplementation?: boolean;
  dtosUsed?: string[];
}

/**
 * Dependency chain node
 */
export interface DependencyNode {
  name: string;
  relativePath: string;
  architectureLayer: ArchitectureLayer;
  dependsOn: DependencyNode[];
  usedBy: DependencyNode[];
}