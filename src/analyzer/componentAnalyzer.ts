import fs from "fs/promises";
import ts from "typescript";
import type {
  ComponentAnalysis,
  ImportInfo,
  ArchitectureLayer,
  PhiComplianceInfo,
  ProjectConfig,
} from "../types.js";

/**
 * Component Analyzer - AST-Based
 * Uses TypeScript Compiler API for accurate code analysis instead of regex
 */
export class ComponentAnalyzer {
  private config?: ProjectConfig;

  constructor(config?: ProjectConfig) {
    this.config = config;
  }

  /**
   * Extract <script> or <script setup> content from a .vue SFC
   */
  private extractVueScript(content: string): string {
    // Match <script setup lang="ts"> or <script lang="ts"> blocks
    const scriptMatch = content.match(
      /<script\b[^>]*>([\s\S]*?)<\/script>/
    );
    return scriptMatch ? scriptMatch[1] : "";
  }

  async analyzeComponent(
    filePath: string,
    componentName: string,
    layer: ArchitectureLayer = "component"
  ): Promise<ComponentAnalysis> {
    try {
      const rawContent = await fs.readFile(filePath, "utf-8");
      const isVue = filePath.endsWith(".vue");

      // For .vue files, extract the <script> block for AST analysis
      let content = isVue ? this.extractVueScript(rawContent) : rawContent;

      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

      const base = this.analyzeWithAST(sourceFile, content, componentName, filePath);

      // Vue: analyze <template> block for child components, events, v-model
      if (isVue) {
        const templateAnalysis = this.analyzeVueTemplate(rawContent);
        base.childComponents = [...new Set([...(base.childComponents || []), ...templateAnalysis.childComponents])].sort();
        base.eventHandlers = [...new Set([...(base.eventHandlers || []), ...templateAnalysis.eventHandlers])].sort();

        // Extract emits from defineEmits / Options API
        base.emits = this.extractVueEmits(sourceFile);

        // Detect v-model bindings: emits matching "update:xxx" pattern
        if (base.emits?.length) {
          const vModelBindings = base.emits
            .filter((e) => e.startsWith("update:"))
            .map((e) => e.slice("update:".length));
          if (vModelBindings.length > 0) {
            base.vModelBindings = vModelBindings;
          }
        }

        // Use full content for accessibility (includes <template>)
        base.accessibility = this.extractAccessibility(rawContent);
      }

      if (layer === "hook") {
        Object.assign(base, this.analyzeHookAST(sourceFile, content));
      } else if (layer === "service" || layer === "adapter") {
        Object.assign(base, this.analyzeServiceOrAdapterAST(sourceFile, content));
      }

      if (layer === "hook" || layer === "component" || layer === "page") {
        base.phiCompliance = this.checkPhiComplianceAST(sourceFile, content);
      }

      return base;
    } catch (error) {
      console.error(`Error analyzing ${filePath}:`, error);
      return {};
    }
  }

  /**
   * AST-based analysis — replaces regex for accuracy
   */
  private analyzeWithAST(
    sourceFile: ts.SourceFile,
    content: string,
    componentName: string,
    filePath?: string
  ): ComponentAnalysis {
    const hooks = new Set<string>();
    const stateVariables: string[] = [];
    const childComponents = new Set<string>();
    const eventHandlers = new Set<string>();
    const imports: ImportInfo[] = [];
    let line: number | undefined;
    let exportType: "named" | "default" | "none" = "none";
    let description: string | undefined;

    const filteredJsxNames = new Set([
      "Fragment", "Provider", "Consumer", "Suspense", "StrictMode",
    ]);

    const visit = (node: ts.Node) => {
      // Extract imports
      if (ts.isImportDeclaration(node)) {
        const imp = this.extractImportFromNode(node, filePath);
        if (imp) imports.push(imp);
      }

      // Find component declaration line + export type + JSDoc
      if (ts.isFunctionDeclaration(node) && node.name?.text === componentName) {
        line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        exportType = this.getExportType(node);
        description = this.getJSDocFromNode(node, sourceFile);
      }
      if (ts.isVariableStatement(node)) {
        const decl = node.declarationList.declarations[0];
        if (decl && ts.isIdentifier(decl.name) && decl.name.text === componentName) {
          line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          exportType = this.getExportType(node);
          description = this.getJSDocFromNode(node, sourceFile);
        }
      }

      // Extract hook calls: useXxx(...) or React.useXxx(...)
      if (ts.isCallExpression(node)) {
        const hookName = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : undefined;
        if (hookName && /^use[A-Z]/.test(hookName)) {
          hooks.add(hookName);
        }
      }

      // Extract useState destructuring: const [x, setX] = useState(...)
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          node.initializer.expression.text === "useState" &&
          ts.isArrayBindingPattern(node.name)
        ) {
          const first = node.name.elements[0];
          if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
            if (first.name.text !== "_") {
              stateVariables.push(first.name.text);
            }
          }
        }

        // Vue: const x = ref(...), reactive({...}), computed(...), shallowRef(...)
        if (
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          ["ref", "reactive", "computed", "shallowRef", "shallowReactive"].includes(node.initializer.expression.text) &&
          ts.isIdentifier(node.name) &&
          node.name.text !== "_"
        ) {
          stateVariables.push(node.name.text);
        }
      }

      // Extract JSX elements (child components)
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const { tagName } = node;
        const name = ts.isIdentifier(tagName) ? tagName.text
          : ts.isPropertyAccessExpression(tagName) ? tagName.getText(sourceFile)
          : undefined;
        if (name && /^[A-Z]/.test(name) && !filteredJsxNames.has(name)) {
          childComponents.add(name);
        }
      }

      // Extract JSX event handler attributes: onClick={...}
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
        const attrName = node.name.text;
        if (/^on[A-Z]/.test(attrName)) {
          eventHandlers.add(attrName);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Detect data fetching pattern
    const hooksArray = Array.from(hooks).sort();
    const dataFetchingPattern = this.detectDataFetchingPattern(content, hooksArray);

    // Extract accessibility info (keep regex here — it's scanning HTML-like content)
    const accessibility = this.extractAccessibility(content);

    return {
      line,
      exportType,
      description,
      hooks: hooksArray,
      stateVariables: stateVariables.sort(),
      childComponents: Array.from(childComponents).sort(),
      eventHandlers: Array.from(eventHandlers).sort(),
      imports,
      dataFetchingPattern,
      accessibility,
    };
  }

  /**
   * Extract import info from an import declaration AST node
   */
  private extractImportFromNode(
    node: ts.ImportDeclaration,
    filePath?: string
  ): ImportInfo | null {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) return null;

    const source = moduleSpecifier.text;
    const clause = node.importClause;
    if (!clause) return null;

    const names: string[] = [];
    let type: "named" | "default" | "namespace" = "named";

    // Default import
    if (clause.name) {
      type = "default";
      names.push(clause.name.text);
    }

    // Named / namespace imports
    if (clause.namedBindings) {
      if (ts.isNamedImports(clause.namedBindings)) {
        type = clause.name ? "default" : "named";
        for (const element of clause.namedBindings.elements) {
          names.push(element.name.text);
        }
      } else if (ts.isNamespaceImport(clause.namedBindings)) {
        type = "namespace";
        names.push(clause.namedBindings.name.text);
      }
    }

    if (names.length === 0) return null;

    return {
      type,
      names,
      source,
      resolvedPath: this.resolveImportPath(source, filePath),
    };
  }

  /**
   * Resolve import path using configured aliases
   */
  private resolveImportPath(
    importSource: string,
    _filePath?: string
  ): string | undefined {
    if (this.config?.aliases) {
      for (const [alias, target] of Object.entries(this.config.aliases)) {
        if (importSource.startsWith(alias)) {
          return target + importSource.slice(alias.length);
        }
      }
    }
    // Default @/ alias
    if (importSource.startsWith("@/")) {
      return `src/${importSource.slice(2)}`;
    }
    if (!importSource.startsWith(".")) {
      return undefined;
    }
    return importSource;
  }

  /**
   * Get export type from a node
   */
  private getExportType(node: ts.Node): "named" | "default" | "none" {
    if (!ts.canHaveModifiers(node)) return "none";
    const modifiers = ts.getModifiers(node);
    if (!modifiers) return "none";

    let hasExport = false;
    let hasDefault = false;
    for (const mod of modifiers) {
      if (mod.kind === ts.SyntaxKind.ExportKeyword) hasExport = true;
      if (mod.kind === ts.SyntaxKind.DefaultKeyword) hasDefault = true;
    }

    if (hasExport && hasDefault) return "default";
    if (hasExport) return "named";
    return "none";
  }

  /**
   * Extract JSDoc comment from a node using TS API
   */
  private getJSDocFromNode(node: ts.Node, _sourceFile: ts.SourceFile): string | undefined {
    const jsDocs = (node as any).jsDoc as ts.JSDoc[] | undefined;
    if (!jsDocs || jsDocs.length === 0) return undefined;

    const comment = jsDocs[0].comment;
    if (typeof comment === "string") return comment;
    if (Array.isArray(comment)) {
      return comment.map((c: any) => (typeof c === "string" ? c : c.text || "")).join("");
    }
    return undefined;
  }

  /**
   * Detect data fetching pattern from hooks list
   */
  private detectDataFetchingPattern(
    content: string,
    hooks: string[]
  ): string | undefined {
    if (
      hooks.includes("useQuery") ||
      hooks.includes("useMutation") ||
      hooks.includes("useQueryClient")
    ) {
      return "react-query";
    }

    if (hooks.includes("useSWR")) {
      return "swr";
    }

    if (hooks.includes("useEffect")) {
      if (/useEffect[^}]*\bfetch\s*\(/s.test(content)) {
        return "useEffect-fetch";
      }
      if (/useEffect[^}]*\baxios\./s.test(content)) {
        return "useEffect-axios";
      }
    }

    // Vue: onMounted/watchEffect with service/adapter calls
    if (content.includes("onMounted") || content.includes("watchEffect")) {
      if (/(?:Service|Adapter)\.\w+\s*\(/.test(content)) {
        return "lifecycle-service-call";
      }
    }

    const dataHooks = hooks.filter(
      (h) =>
        h.startsWith("use") &&
        (h.toLowerCase().includes("fetch") ||
          h.toLowerCase().includes("load") ||
          h.toLowerCase().includes("get") ||
          h.toLowerCase().includes("data") ||
          /^use[A-Z][a-z]+s$/.test(h))
    );

    if (dataHooks.length > 0) {
      return `custom-composable: ${dataHooks[0]}`;
    }

    return undefined;
  }

  // ========== Hook Analysis (AST-based) ==========

  private extractHookSignature(
    params: ts.NodeArray<ts.ParameterDeclaration>,
    returnType: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile
  ): Pick<ComponentAnalysis, "parameters" | "returnType"> {
    const result: Pick<ComponentAnalysis, "parameters" | "returnType"> = {};
    if (params.length > 0) {
      result.parameters = params.map((p) => {
        if (ts.isIdentifier(p.name)) return p.name.text;
        if (ts.isObjectBindingPattern(p.name)) {
          return p.name.elements
            .map((e) => (ts.isIdentifier(e.name) ? e.name.text : ""))
            .filter(Boolean)
            .join(", ");
        }
        return p.name.getText(sourceFile);
      });
    }
    if (returnType) {
      result.returnType = returnType.getText(sourceFile);
    }
    return result;
  }

  private isAdapterOrServiceName(name: string): boolean {
    return /(?:Adapter|Service)/i.test(name);
  }

  private analyzeHookAST(sourceFile: ts.SourceFile, content: string): Partial<ComponentAnalysis> {
    const result: Partial<ComponentAnalysis> = {};
    const queryKeys: string[] = [];
    const adapterCalls = new Set<string>();

    const visit = (node: ts.Node) => {
      // Function declaration hooks: export function useXxx(...) { ... }
      if (ts.isFunctionDeclaration(node) && node.name?.text.startsWith("use")) {
        Object.assign(result, this.extractHookSignature(node.parameters, node.type, sourceFile));
      }

      // Arrow function hooks: export const useXxx = (...) => { ... }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.startsWith("use") &&
        node.initializer &&
        ts.isArrowFunction(node.initializer)
      ) {
        Object.assign(result, this.extractHookSignature(node.initializer.parameters, node.initializer.type, sourceFile));
      }

      // React Query keys
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "queryKey" &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        queryKeys.push(node.initializer.getText(sourceFile));
      }

      // Adapter/service calls: direct function calls
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && this.isAdapterOrServiceName(node.expression.text)) {
        adapterCalls.add(node.expression.text);
      }

      // Adapter/service calls: property access (someAdapter.method())
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        this.isAdapterOrServiceName(node.expression.expression.text)
      ) {
        adapterCalls.add(node.expression.expression.text);
      }

      // Adapter/service detection from imports
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const src = node.moduleSpecifier.text;
        if (src.includes("services") || src.includes("adapters")) {
          const match = src.match(/\/(\w+)$/);
          if (match) adapterCalls.add(match[1]);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (queryKeys.length > 0) result.queryKeys = queryKeys;
    if (adapterCalls.size > 0) result.adapterCalls = Array.from(adapterCalls).sort();

    return result;
  }

  // ========== Service/Adapter Analysis (AST-based) ==========

  private getEndpointText(arg: ts.Expression, sourceFile: ts.SourceFile): string | undefined {
    if (ts.isStringLiteral(arg)) return arg.text;
    if (ts.isTemplateExpression(arg)) return arg.getText(sourceFile);
    return undefined;
  }

  private analyzeServiceOrAdapterAST(sourceFile: ts.SourceFile, content: string): Partial<ComponentAnalysis> {
    const result: Partial<ComponentAnalysis> = {};
    const endpoints: string[] = [];
    const dtos = new Set<string>();
    const httpMethods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

    const visit = (node: ts.Node) => {
      // Detect API endpoints from method calls: .get("/path"), .post("/path")
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method = node.expression.name.text.toUpperCase();
        const firstArg = node.arguments[0];
        if (httpMethods.has(method) && firstArg) {
          const path = this.getEndpointText(firstArg, sourceFile);
          if (path) endpoints.push(`${method} ${path}`);
        }
      }

      // Detect fetch() calls
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
        const firstArg = node.arguments[0];
        if (firstArg) {
          const path = this.getEndpointText(firstArg, sourceFile);
          if (path) endpoints.push(path);
        }
      }

      // Detect DTO type references
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && /Dto$/.test(node.typeName.text)) {
        dtos.add(node.typeName.text);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (endpoints.length > 0) {
      result.apiEndpoints = [...new Set(endpoints)];
    }

    // Mock detection
    result.hasMockImplementation =
      (/Mock\w+Adapter|mock\w+/i.test(content) && /Api\w+Adapter|Real\w+/i.test(content)) ||
      /useMockData|config\.useMock/i.test(content);

    if (dtos.size > 0) {
      result.dtosUsed = Array.from(dtos).sort();
    }

    return result;
  }

  // ========== PHI Compliance Helpers ==========

  private findZeroValuedProperties(
    callNode: ts.CallExpression,
    sourceFile: ts.SourceFile,
    propNames: string[]
  ): Set<string> {
    const found = new Set<string>();
    for (const arg of callNode.arguments) {
      if (!ts.isObjectLiteralExpression(arg)) continue;
      for (const prop of arg.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        if (propNames.includes(prop.name.text) && prop.initializer.getText(sourceFile) === "0") {
          found.add(prop.name.text);
        }
      }
    }
    return found;
  }

  private isConsoleCall(node: ts.Node): boolean {
    return (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console"
    );
  }

  // ========== PHI Compliance (AST-based) ==========

  private checkPhiComplianceAST(sourceFile: ts.SourceFile, content: string): PhiComplianceInfo {
    const violations: string[] = [];
    let hasUseQuery = false;
    let hasZeroCacheTime = false;
    let hasZeroStaleTime = false;
    let hasConsoleLogNearPhi = false;
    let hasLocalStorageUsage = false;
    let hasSessionStorageUsage = false;

    const visit = (node: ts.Node) => {
      // Detect useQuery calls and check their options
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useQuery") {
        hasUseQuery = true;
        const zeroPropNames = this.findZeroValuedProperties(node, sourceFile, ["gcTime", "staleTime"]);
        if (zeroPropNames.has("gcTime")) hasZeroCacheTime = true;
        if (zeroPropNames.has("staleTime")) hasZeroStaleTime = true;
      }

      // Detect console.log with PHI-related variables
      if (this.isConsoleCall(node)) {
        const argsText = (node as ts.CallExpression).arguments.map((a) => a.getText(sourceFile).toLowerCase()).join(" ");
        if (/patient|phi|mrn|ssn|dob/.test(argsText)) {
          hasConsoleLogNearPhi = true;
        }
      }

      // Detect localStorage/sessionStorage usage
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "localStorage") hasLocalStorageUsage = true;
        if (node.expression.text === "sessionStorage") hasSessionStorageUsage = true;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (hasUseQuery && !hasZeroCacheTime) {
      violations.push("useQuery without gcTime: 0 - PHI may be cached");
    }
    if (hasUseQuery && !hasZeroStaleTime) {
      violations.push("useQuery without staleTime: 0 - PHI may be stale-cached");
    }
    if (hasConsoleLogNearPhi) {
      violations.push("console.log may contain PHI data");
    }
    if (hasLocalStorageUsage) {
      violations.push("localStorage usage detected - PHI must not be stored in localStorage");
    }
    if (hasSessionStorageUsage) {
      violations.push("sessionStorage usage detected - PHI must not be stored in sessionStorage");
    }

    return {
      hasZeroCacheTime: hasZeroCacheTime || !hasUseQuery,
      hasZeroStaleTime: hasZeroStaleTime || !hasUseQuery,
      hasConsoleLogNearPhi,
      hasLocalStorageUsage,
      hasSessionStorageUsage,
      violations,
    };
  }

  // ========== Vue Template Analysis (regex-based) ==========

  private static VUE_BUILTINS = new Set([
    "Teleport", "Transition", "TransitionGroup", "KeepAlive", "Suspense",
    "Component", "Slot",
  ]);

  private analyzeVueTemplate(fullContent: string): {
    childComponents: string[];
    eventHandlers: string[];
  } {
    const templateMatch = fullContent.match(/<template\b[^>]*>([\s\S]*?)<\/template>/);
    if (!templateMatch) return { childComponents: [], eventHandlers: [] };
    const template = templateMatch[1];

    // PascalCase component usages: <ComponentName or <ComponentName>
    const childComponents = new Set<string>();
    const componentRegex = /<([A-Z][A-Za-z0-9]+)[\s/>]/g;
    let match;
    while ((match = componentRegex.exec(template))) {
      if (!ComponentAnalyzer.VUE_BUILTINS.has(match[1])) {
        childComponents.add(match[1]);
      }
    }

    // Event handlers: @eventName="..." or v-on:eventName="..."
    const eventHandlers = new Set<string>();
    const eventRegex = /(?:@|v-on:)([\w:.]+)/g;
    while ((match = eventRegex.exec(template))) {
      eventHandlers.add(match[1]);
    }

    return {
      childComponents: Array.from(childComponents).sort(),
      eventHandlers: Array.from(eventHandlers).sort(),
    };
  }

  // ========== Vue Emit Extraction (AST-based) ==========

  private extractVueEmits(sourceFile: ts.SourceFile): string[] {
    const emits: string[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineEmits") {
        // Pattern 1: defineEmits<{ (e: "name", val: T): void }>()
        if (node.typeArguments?.[0] && ts.isTypeLiteralNode(node.typeArguments[0])) {
          for (const member of node.typeArguments[0].members) {
            // Call signature: (e: "name", ...): void
            if (ts.isCallSignatureDeclaration(member) && member.parameters.length > 0) {
              const firstParam = member.parameters[0];
              if (firstParam.type && ts.isLiteralTypeNode(firstParam.type) && ts.isStringLiteral(firstParam.type.literal)) {
                emits.push(firstParam.type.literal.text);
              }
            }
          }
        }
        // Pattern 2: defineEmits(["name1", "name2"])
        if (node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])) {
          for (const el of node.arguments[0].elements) {
            if (ts.isStringLiteral(el)) {
              emits.push(el.text);
            }
          }
        }
      }

      // Options API: emits: ["update:modelValue", "close"]
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "emits" &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const el of node.initializer.elements) {
          if (ts.isStringLiteral(el)) emits.push(el.text);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return [...new Set(emits)].sort();
  }

  // ========== Accessibility (keep regex — fine for HTML attribute scanning) ==========

  private uniqueSortedMatches(content: string, regex: RegExp, transform: (m: RegExpMatchArray) => string): string[] {
    return Array.from(new Set(Array.from(content.matchAll(regex)).map(transform))).sort();
  }

  private extractAccessibility(content: string) {
    const ariaAttributes = this.uniqueSortedMatches(content, /aria-(\w+)=/g, (m) => `aria-${m[1]}`);
    const roles = this.uniqueSortedMatches(content, /role="([^"]+)"/g, (m) => m[1]);

    const semanticTags = [
      "nav", "main", "section", "article", "aside",
      "header", "footer", "button", "form", "label",
      "fieldset", "legend",
    ];
    const semanticElements = semanticTags
      .filter((tag) => new RegExp(`<${tag}[\\s>]`, "gi").test(content))
      .sort();

    const keyboardChecks: [string, string][] = [
      ["onKeyDown", "onKeyDown"], ["onKeyPress", "onKeyPress"],
      ["onKeyUp", "onKeyUp"], ["tabIndex", "tabIndex="],
    ];
    const keyboardHandlers = keyboardChecks
      .filter(([, search]) => content.includes(search))
      .map(([name]) => name)
      .sort();

    const hasTestId = /data-testid=/.test(content);
    const hasScreenReaderSupport =
      /sr-only|visually-hidden|screen-reader/i.test(content) ||
      ariaAttributes.some(
        (attr) => attr.includes("aria-label") || attr.includes("aria-describedby")
      );

    return {
      ariaAttributes,
      roles,
      semanticElements,
      keyboardHandlers,
      hasTestId,
      hasScreenReaderSupport,
    };
  }

  // Keep extractImports as a public method for backward compatibility
  extractImports(content: string, filePath?: string): ImportInfo[] {
    const sourceFile = ts.createSourceFile(
      filePath || "temp.ts",
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const imports: ImportInfo[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const imp = this.extractImportFromNode(node, filePath);
        if (imp) imports.push(imp);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return imports;
  }
}
