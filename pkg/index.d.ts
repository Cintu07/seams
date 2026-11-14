export type FileInput = string | ArrayBuffer | ArrayBufferView | Blob;
export type Language =
  | 'ts' | 'rust' | 'python' | 'c' | 'go' | 'java' | 'kotlin' | 'csharp' | 'swift' | 'scala' | 'ruby'
  | 'shell' | 'php' | 'lua' | 'sql' | 'zig' | 'nasm' | 'wat' | 'config' | 'json' | 'css';

export interface Theme {
  name: string;
  /** canvas colours: background, text, gutter, row and mark colours, selection, find, token colours */
  renderer: Record<string, string>;
  [key: string]: unknown;
}
export type ThemeName = 'sage' | 'dusk' | 'paper' | 'clay' | 'ink' | 'harbor' | 'clear';
export declare const THEMES: Record<ThemeName, Theme>;

export interface ViewerOptions {
  theme?: ThemeName | Theme;
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
  /**
   * ms: diff (WebAssembly), layout, firstFrame (from setFiles to the whole diff on screen), firstScreen
   * (to the first pixels: on files over 1 MiB whose first screen of lines is unchanged, those lines are
   * drawn while the diff runs), states (highlighter pass)
   */
  timing: { diff: number; layout: number; firstFrame: number; firstScreen: number; states?: number };
}
export interface DiffViewer {
  setFiles(oldFile: FileInput, newFile: FileInput, options?: FileOptions): Promise<DiffStats | null>;
  /** Open a .seamspack made ahead of time (tools/seams-pack.mjs): a URL, the bytes, or a Blob. */
  setPack(pack: string | URL | ArrayBuffer | ArrayBufferView | Blob): Promise<DiffStats | null>;
  readonly stats: DiffStats | null;
  setView(view: 'unified' | 'split'): void;
  setTheme(theme: ThemeName | Theme): void;
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
