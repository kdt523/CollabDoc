import React, { useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { yCollab } from 'y-codemirror.next';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import '../styles/editor.css';

function replaceSelection(view, formatter) {
  const sel = view.state.selection.main;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  const inserted = formatter(selected);
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: inserted }, scrollIntoView: true });
  view.focus();
}

function applyPrefixToSelectedLines(view, prefix) {
  const state = view.state;
  const main = state.selection.main;
  const fromLine = state.doc.lineAt(main.from).number;
  const toLine = state.doc.lineAt(main.to).number;
  const changes = [];
  for (let n = fromLine; n <= toLine; n++) {
    const line = state.doc.line(n);
    changes.push({ from: line.from, to: line.from, insert: prefix(n - fromLine) });
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

export default function Editor({ ydoc, ytext, active, awareness, user, sendAwareness, onSelectionChange }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const surfaceRef = useRef(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const sendAwarenessRef = useRef(sendAwareness);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    sendAwarenessRef.current = sendAwareness;
  }, [sendAwareness]);

  useEffect(() => {
    if (!active || !ytext || !ydoc || !containerRef.current) return;

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        basicSetup,
        awareness ? yCollab(ytext, awareness, {
          user: { name: user?.name, color: '#30bced', colorLight: '#30bced33' },
        }) : [],
        EditorView.theme({
          '&': { backgroundColor: '#1e1e1e', color: '#e5e7eb', height: '100% !important', minHeight: '600px' },
          '.cm-content': { caretColor: '#ffffff' },
          '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#9ca3af', border: 'none' },
          '.cm-line': { color: '#e5e7eb' },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.selectionSet) return;
          
          const sel = update.state.selection.main;
          
          if (awareness) {
            const anchorRel = Y.createRelativePositionFromTypeIndex(ytext, sel.anchor);
            const headRel = Y.createRelativePositionFromTypeIndex(ytext, sel.head);
            const cursor = {
              anchor: typeof anchorRel.toJSON === 'function' ? anchorRel.toJSON() : anchorRel,
              head: typeof headRel.toJSON === 'function' ? headRel.toJSON() : headRel,
            };
            sendAwarenessRef.current(cursor, { anchor: sel.anchor, head: sel.head });
          }

          if (onSelectionChangeRef.current) {
            const coords = update.view.coordsAtPos(sel.from);
            const parentRect = containerRef.current.getBoundingClientRect();
            const pos = coords ? { 
              top: coords.top - parentRect.top - 40, 
              left: coords.left - parentRect.left 
            } : { top: 0, left: 0 };
            
            onSelectionChangeRef.current({ from: sel.from, to: sel.to }, pos);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    view.contentDOM.spellcheck = true;
    viewRef.current = view;
    window.cmView = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      window.cmView = null;
    };
  }, [active, ytext, ydoc, awareness]);

  const withView = (fn) => () => {
    const view = viewRef.current;
    if (!view) return;
    fn(view);
  };

  if (!active) {
    return (
      <div className="cm-editor-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Connecting...</div>
      </div>
    );
  }

  return (
    <div className="cm-editor-wrap">
      <div className="editor-toolbar">
        <button className="toolbar-btn" onClick={withView((v) => undo(v))} title="Undo">↶</button>
        <button className="toolbar-btn" onClick={withView((v) => redo(v))} title="Redo">↷</button>
        <button className="toolbar-btn" onClick={() => window.print()} title="Print">🖨</button>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `**${t || 'bold'}**`))} title="Bold"><b>B</b></button>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `*${t || 'italic'}*`))} title="Italic"><i>I</i></button>
      </div>
      <div ref={surfaceRef} className="editor-surface">
        <div ref={containerRef} className="cm-editor" />
      </div>
    </div>
  );
}
