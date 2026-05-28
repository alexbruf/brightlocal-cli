// Type definitions for the brightlocal-cli WebAssembly build.

export interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
}

export interface LocationSearchOptions {
  query: string;
  country?: string;
  limit?: number;
}

export interface LocationSearchResponse {
  total_count: number;
  items: Location[];
}

export interface RankingResult {
  search_term: string;
  rank: number;
  url?: string;
  source?: string;
}

export interface RankingsCheckOptions {
  business_name: string;
  location: string;
  search_terms: string[];
}

export interface RankingsCheckResponse {
  success: boolean;
  request_id: string;
  results?: RankingResult[];
}

export interface RankingsGetResponse {
  success: boolean;
  request_id: string;
  status: string;
  results?: RankingResult[];
}

export interface VersionInfo {
  version: string;
  commit: string;
  date: string;
}

export interface BrightLocal {
  locationsSearch(apiKey: string, options: LocationSearchOptions): Promise<LocationSearchResponse>;
  rankingsCheck(apiKey: string, options: RankingsCheckOptions): Promise<RankingsCheckResponse>;
  rankingsGet(apiKey: string, requestId: string): Promise<RankingsGetResponse>;
  version(): VersionInfo;
}

/**
 * Instantiate the Go wasm runtime and return the BrightLocal API.
 * Cached per isolate, so it is safe (and cheap) to call on every request.
 */
export function createBrightLocal(): Promise<BrightLocal>;

export const wasmModule: WebAssembly.Module;
