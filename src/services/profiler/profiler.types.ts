export interface ProfilerOptions {
  collection: string; // e.g., 'songs', 'artists'
  index?: string;     // OpenSearch index (defaults to collection name)
}

// A. Schema Inference
export interface InferredField {
  name: string;
  type: string; // 'string', 'number', 'boolean', 'object', 'array', 'date', 'unknown'
  ref?: string;
}

export interface SchemaInferenceResult {
  collection: string;
  sampleSize: number;
  fields: InferredField[];
}

// B. Cardinality and Facet Generation
export interface FieldCardinality {
  field: string;
  uniqueCount: number;
  recommendedUsage: 'dropdown' | 'free-text';
  topValues?: Array<{ value: string | number; count: number }>;
}

export interface CardinalityResult {
  index: string;
  fields: FieldCardinality[];
}

// C. Completeness and Null Tracking
export interface FieldCompleteness {
  field: string;
  totalCount: number;
  missingCount: number;
  fillRatePercentage: number;
}

export interface CompletenessResult {
  index: string;
  fields: FieldCompleteness[];
}

// D. Distribution Percentiles
export interface NumericDistribution {
  field: string;
  min: number | null;
  max: number | null;
  avg: number | null;
  percentiles: {
    p1: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p99: number | null;
  };
}

export interface DistributionResult {
  index: string;
  fields: NumericDistribution[];
}
