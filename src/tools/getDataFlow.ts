import type { ComponentScanner } from "../scanner/componentScanner.js";
import type { CacheManager } from "../cache/cacheManager.js";
import type { Component } from "../types.js";
import { ensureCatalog } from "./shared.js";

export interface DataFlowStep {
  name: string;
  relativePath: string;
  layer: string;
  methods?: string[];
  endpoints?: string[];
}

export interface DataFlowChain {
  component: DataFlowStep;
  composables: DataFlowStep[];
  services: DataFlowStep[];
  adapters: DataFlowStep[];
  endpoints: string[];
}

export interface DataFlowResult {
  target: string;
  chains: DataFlowChain[];
}

/**
 * Trace the full data path from a component through composables → services → adapters → API endpoints.
 * Replaces the common multi-step debugging pattern of chaining get_component_detail + get_hook_detail + manual tracing.
 */
export async function getDataFlow(
  args: { name: string },
  scanner: ComponentScanner,
  cache: CacheManager
): Promise<DataFlowResult | null> {
  const catalog = await ensureCatalog(scanner, cache);

  const matches = cache.getByName(args.name);
  const target = matches[0];
  if (!target) return null;

  const chains: DataFlowChain[] = [];

  // Find composables used by this component (from hooks list and imports)
  const composableNames = new Set<string>();
  for (const hookName of target.hooks || []) {
    if (hookName.startsWith("use") && !isVueBuiltinHook(hookName)) {
      composableNames.add(hookName);
    }
  }
  // Also check imports from composables directory
  for (const imp of target.imports || []) {
    if (imp.source.includes("composable") || imp.source.includes("hooks")) {
      for (const name of imp.names) {
        if (name.startsWith("use")) composableNames.add(name);
      }
    }
  }

  // Always check for direct service imports from the component
  const directChain = traceFromServiceCalls(target, catalog, cache);
  if (directChain) {
    chains.push({
      component: toStep(target),
      composables: [],
      services: directChain.services,
      adapters: directChain.adapters,
      endpoints: directChain.endpoints,
    });
  }

  // Also trace through composables
  for (const composableName of composableNames) {
    const composable = cache.getByName(composableName)[0];
    if (!composable) continue;

    const serviceTrace = traceFromServiceCalls(composable, catalog, cache);
    if (serviceTrace) {
      chains.push({
        component: toStep(target),
        composables: [toStep(composable, composable.adapterCalls)],
        services: serviceTrace.services,
        adapters: serviceTrace.adapters,
        endpoints: serviceTrace.endpoints,
      });
    }
  }

  // Deduplicate chains with identical endpoints
  const seen = new Set<string>();
  const uniqueChains = chains.filter((chain) => {
    const key = chain.composables.map(c => c.name).join(",") + ":" + chain.endpoints.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    target: target.name,
    chains: uniqueChains.length > 0 ? uniqueChains : chains,
  };
}

function traceFromServiceCalls(
  source: Component,
  catalog: { components: Component[] },
  cache: CacheManager
): { services: DataFlowStep[]; adapters: DataFlowStep[]; endpoints: string[] } | null {
  const services: DataFlowStep[] = [];
  const adapters: DataFlowStep[] = [];
  const endpoints: string[] = [];

  // Find services called by the source
  const serviceCalls = [...(source.adapterCalls || [])];
  // Also check imports from services directory
  for (const imp of source.imports || []) {
    if (imp.source.includes("service") || imp.source.includes("adapter")) {
      for (const name of imp.names) {
        if (!serviceCalls.includes(name)) serviceCalls.push(name);
      }
    }
  }

  for (const serviceName of serviceCalls) {
    const service = cache.getByName(serviceName)[0];
    if (!service) continue;
    if (service.architectureLayer !== "service") continue;

    services.push(toStep(service));

    // Find adapters called by the service
    const adapterCalls = [...(service.adapterCalls || [])];
    for (const imp of service.imports || []) {
      if (imp.source.includes("adapter")) {
        for (const name of imp.names) {
          if (!adapterCalls.includes(name)) adapterCalls.push(name);
        }
      }
    }

    for (const adapterName of adapterCalls) {
      const adapter = cache.getByName(adapterName)[0];
      if (!adapter) continue;
      if (adapter.architectureLayer !== "adapter") continue;

      adapters.push(toStep(adapter, undefined, adapter.apiEndpoints));

      if (adapter.apiEndpoints) {
        endpoints.push(...adapter.apiEndpoints);
      }
    }
  }

  if (services.length === 0 && adapters.length === 0) return null;
  return { services, adapters, endpoints: [...new Set(endpoints)] };
}

function toStep(item: Component, methods?: string[], apiEndpoints?: string[]): DataFlowStep {
  const step: DataFlowStep = {
    name: item.name,
    relativePath: item.relativePath,
    layer: item.architectureLayer,
  };
  if (methods?.length) step.methods = methods;
  if (apiEndpoints?.length) step.endpoints = apiEndpoints;
  return step;
}

function isVueBuiltinHook(name: string): boolean {
  return [
    "useRoute", "useRouter", "useSlots", "useAttrs",
    "useCssModule", "useCssVars",
  ].includes(name);
}
