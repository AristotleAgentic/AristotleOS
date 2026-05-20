/** Stable id helper: "<prefix>_<uuid>". */
export declare function newId(prefix: string): string;
export declare function nowIso(): string;
export declare function isoPlusSeconds(base: Date | string, seconds: number): string;
