import type { MetadataFilters, MetadataRecord } from "../../../lib/metadataFilters";

type PrimitiveMetadataValue = string | number | boolean;

function primitiveValues(value: unknown): PrimitiveMetadataValue[] {
  if (typeof value === "string" || typeof value === "boolean") {
    return [value];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(primitiveValues);
  }
  return [];
}

function parseBound(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type MetadataMatcher = (metadata: MetadataRecord | null | undefined) => boolean;

export function compileMetadataFilters(filters: MetadataFilters): MetadataMatcher | null {
  const clauses: Array<MetadataMatcher> = [];

  for (const [key, filter] of Object.entries(filters)) {
    if (filter.kind === "enum") {
      if (filter.selected.length === 0 && filter.includeMissing !== true) {
        continue;
      }
      if (filter.includeMissing === true) {
        clauses.push((metadata) => primitiveValues(metadata?.[key]).length === 0);
        continue;
      }
      const selected = new Set(filter.selected);
      clauses.push((metadata) =>
        primitiveValues(metadata?.[key]).some((value) => selected.has(String(value))),
      );
      continue;
    }

    const min = parseBound(filter.min);
    const max = parseBound(filter.max);
    if (min === null && max === null && filter.includeMissing !== true) {
      continue;
    }
    if (filter.includeMissing === true) {
      clauses.push((metadata) => primitiveValues(metadata?.[key]).length === 0);
      continue;
    }

    clauses.push((metadata) =>
      primitiveValues(metadata?.[key]).some(
        (value) =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          (min === null || value >= min) &&
          (max === null || value <= max),
      ),
    );
  }

  if (clauses.length === 0) {
    return null;
  }

  return (metadata) => clauses.every((clause) => clause(metadata));
}
