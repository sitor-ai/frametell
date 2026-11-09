export interface StoryboardIssue { level: 'red' | 'yellow'; page?: string; beat?: number; msg: string }
export declare function lintStoryboard(sb: unknown, opts?: { source?: string }): StoryboardIssue[];
/** a page's rhythm in the storyboard: its energy, its signature move, how it comes in */
export declare const ENERGIES: string[];
export declare const MOVES: string[];
export declare const TURNS: string[];
