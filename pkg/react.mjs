// React wrapper: <SeamsDiff oldFile={a} newFile={b} name="main.ts" />. Give it a height (style or class).
import { createElement, useEffect, useRef } from 'react';
import { createDiffViewer } from './index.mjs';

export function SeamsDiff({ oldFile, newFile, name, oldName, newName, language, view = 'unified', theme = 'sage',
  fontSize = 13, className, style, onLoad, viewerRef }) {
  const host = useRef(null), viewer = useRef(null);
  useEffect(() => {
    const v = createDiffViewer(host.current, { view, theme, fontSize });
    viewer.current = v;
    if (viewerRef) viewerRef.current = v;
    return () => { v.destroy(); viewer.current = null; if (viewerRef) viewerRef.current = null; };
  }, [fontSize]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = viewer.current;
    if (!v || oldFile == null || newFile == null) return;
    v.setFiles(oldFile, newFile, { name, oldName, newName, language }).then((stats) => { if (stats && onLoad) onLoad(stats); });
  }, [oldFile, newFile, name, oldName, newName, language, fontSize]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { viewer.current?.setView(view); }, [view]);
  useEffect(() => { viewer.current?.setTheme(theme); }, [theme]);
  return createElement('div', { ref: host, className, style: { position: 'relative', height: 480, ...style } });
}
