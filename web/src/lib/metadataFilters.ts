export type MetadataRecord = Record<string, unknown>;

export type MetadataFilterDefinition =
  | {
      key: string;
      kind: "enum";
      values: string[];
    }
  | {
      key: string;
      kind: "number";
      min: number;
      max: number;
    };

export type MetadataFilterState =
  | {
      kind: "enum";
      selected: string[];
      includeMissing?: boolean;
    }
  | {
      kind: "number";
      min?: string;
      max?: string;
      includeMissing?: boolean;
    };

export type MetadataFilters = Record<string, MetadataFilterState>;

type PrimitiveMetadataValue = string | number | boolean;

type MetadataCarrier = {
  metadata?: MetadataRecord | null;
};

function visitPrimitiveValues(value: unknown, visit: (value: PrimitiveMetadataValue) => void) {
  if (typeof value === "string" || typeof value === "boolean") {
    visit(value);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      visitPrimitiveValues(entry, visit);
    }
  }
}

function somePrimitiveValue(value: unknown, matches: (value: PrimitiveMetadataValue) => boolean): boolean {
  if (typeof value === "string" || typeof value === "boolean") {
    return matches(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return matches(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (somePrimitiveValue(entry, matches)) {
        return true;
      }
    }
  }
  return false;
}

function enumLabel(value: PrimitiveMetadataValue) {
  return String(value);
}

const compareLabels = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" }).compare;

export function buildMetadataFilterDefinitions(items: MetadataCarrier[]): MetadataFilterDefinition[] {
  const byKey = new Map<
    string,
    {
      allNumbers: boolean;
      min: number;
      max: number;
      labels?: Set<string>;
    }
  >();
  let hasEnumValues = false;
  for (const item of items) {
    for (const [key, raw] of Object.entries(item.metadata ?? {})) {
      visitPrimitiveValues(raw, (value) => {
        let accumulator = byKey.get(key);
        if (!accumulator) {
          accumulator = {
            allNumbers: true,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY,
          };
          byKey.set(key, accumulator);
        }
        if (typeof value === "number") {
          accumulator.min = Math.min(accumulator.min, value);
          accumulator.max = Math.max(accumulator.max, value);
        } else {
          accumulator.allNumbers = false;
          hasEnumValues = true;
        }
      });
    }
  }

  // Numeric-only keys need no retained value list. Collect labels only for keys
  // that became enums after the first pass established their type.
  if (hasEnumValues) {
    for (const item of items) {
      for (const [key, raw] of Object.entries(item.metadata ?? {})) {
        const accumulator = byKey.get(key);
        if (!accumulator || accumulator.allNumbers) {
          continue;
        }
        visitPrimitiveValues(raw, (value) => {
          (accumulator.labels ??= new Set<string>()).add(enumLabel(value));
        });
      }
    }
  }

  return [...byKey.entries()]
    .map(([key, accumulator]): MetadataFilterDefinition => {
      if (accumulator.allNumbers) {
        return {
          key,
          kind: "number",
          min: accumulator.min,
          max: accumulator.max,
        };
      }
      const enumValues = [...(accumulator.labels ?? [])].sort(compareLabels);
      return { key, kind: "enum", values: enumValues };
    })
    .sort((a, b) => compareLabels(a.key, b.key));
}

export function hasActiveMetadataFilters(filters: MetadataFilters) {
  return Object.values(filters).some((filter) => {
    if (filter.kind === "enum") {
      return filter.selected.length > 0 || filter.includeMissing === true;
    }
    return Boolean(filter.min?.trim() || filter.max?.trim() || filter.includeMissing === true);
  });
}

function parseBound(value: string | undefined) {
  if (!value?.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type MetadataMatcher = (metadata: MetadataRecord | null | undefined) => boolean;

export function compileMetadataFilters(filters: MetadataFilters): MetadataMatcher | null {
  const clauses: MetadataMatcher[] = [];

  for (const [key, filter] of Object.entries(filters)) {
    if (filter.kind === "enum") {
      if (filter.selected.length === 0 && filter.includeMissing !== true) {
        continue;
      }
      if (filter.includeMissing === true) {
        clauses.push((metadata) => !somePrimitiveValue(metadata?.[key], () => true));
        continue;
      }
      const selected = new Set(filter.selected);
      clauses.push((metadata) =>
        somePrimitiveValue(metadata?.[key], (value) => selected.has(enumLabel(value))),
      );
      continue;
    }

    const min = parseBound(filter.min);
    const max = parseBound(filter.max);
    if (min === null && max === null && filter.includeMissing !== true) {
      continue;
    }
    if (filter.includeMissing === true) {
      clauses.push((metadata) => !somePrimitiveValue(metadata?.[key], () => true));
      continue;
    }

    clauses.push((metadata) =>
      somePrimitiveValue(
        metadata?.[key],
        (value) =>
          typeof value === "number" &&
          (min === null || value >= min) &&
          (max === null || value <= max),
      ),
    );
  }

  if (clauses.length === 0) {
    return null;
  }

  return (metadata) => {
    for (const clause of clauses) {
      if (!clause(metadata)) {
        return false;
      }
    }
    return true;
  };
}

export function matchesMetadataFilters(metadata: MetadataRecord | null | undefined, filters: MetadataFilters) {
  return compileMetadataFilters(filters)?.(metadata) ?? true;
}
