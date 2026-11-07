export type FileInput = string | ArrayBuffer | ArrayBufferView | Blob;
export type Language = 'ts' | 'rust' | 'python' | 'c' | 'go';

export interface Theme {
  name: string;
  /** canvas colours: background, text, gutter, row and mark colours, selection, find, token colours */
  renderer: Record<string, string>;
  [key: string]: unknown;
}
export declare const THEMES: { sage: Theme; dusk: Theme };

export interface ViewerOptions {
  theme?: 'sage' | 'dusk' | Theme;
  view?: 'unified' | 'split';
  fontSize?: number;
  lineHeight?: number;
  fontFamily?: string;
}
export interface FileOptions {
  /** file name used to pick the language, e.g. "main.rs" */
  name?: string;
  oldName?: string;
  newName?: string;
  /** force a language, or null for plain text */
  language?: Language | null;
}
export interface DiffStats {
  rows: number;
  deleted: number;
  inserted: number;
  changes: number;
  language: Language | null;
  /** ms: diff (WebAssembly), layout, firstFrame (from setFiles to pixels), states (highlighter pass) */
  timing: { diff: number; layout: number; firstFrame: number; states?: number };
}
export interface DiffViewer {
  setFiles(oldFile: FileInput, newFile: FileInput, options?: FileOptions): Promise<DiffStats | null>;
  readonly stats: DiffStats | null;
  setView(view: 'unified' | 'split'): void;
  setTheme(theme: 'sage' | 'dusk' | Theme): void;
  scrollToLine(line: number, side?: 'a' | 'b'): void;
  nextChange(direction?: 1 | -1): boolean;
  openFind(): void;
  selectedText(): string;
  focus(): void;
  destroy(): void;
}
/** Creates a viewer filling `element` (which needs a height). */
export declare function createDiffViewer(element: HTMLElement, options?: ViewerOptions): DiffViewer;
export declare function languageOf(fileName: string): Language | null;
