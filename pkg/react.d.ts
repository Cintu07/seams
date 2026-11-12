import type { CSSProperties, MutableRefObject } from 'react';
import type { FileInput, Language, Theme, DiffStats, DiffViewer } from './index';

export interface SeamsDiffProps {
  oldFile?: FileInput | null;
  newFile?: FileInput | null;
  /** a .seamspack made ahead of time; used instead of oldFile/newFile */
  pack?: string | URL | ArrayBuffer | ArrayBufferView | Blob;
  name?: string;
  oldName?: string;
  newName?: string;
  language?: Language | null;
  view?: 'unified' | 'split';
  theme?: 'sage' | 'dusk' | 'paper' | 'clay' | 'ink' | 'harbor' | 'clear' | Theme;
  fontSize?: number;
  className?: string;
  style?: CSSProperties;
  onLoad?: (stats: DiffStats) => void;
  viewerRef?: MutableRefObject<DiffViewer | null>;
}
export declare function SeamsDiff(props: SeamsDiffProps): JSX.Element;
