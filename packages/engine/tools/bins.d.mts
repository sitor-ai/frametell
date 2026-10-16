export declare const FFMPEG: string;
export declare function ffmpegBin(): string;
export declare function ffmpegFailure(o?: { bin?: string; code?: number | null; signal?: string | null; stderr?: string; stdout?: string; spawnError?: string }): string;
export declare function probe(file: string): { duration: number; width: number; height: number };
export declare function findChrome(): string | undefined;
