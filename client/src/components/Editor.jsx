import React, { useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { yCollab } from 'y-codemirror.next';
import { EditorView, Decoration, MatchDecorator, ViewPlugin, WidgetType } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { undo, redo } from '@codemirror/commands';
import '../styles/editor.css';

// Visual Image Widget for Markdown: ![alt](url)
class ImageWidget extends WidgetType {
  constructor(url, alt) {
    super();
    this.url = url;
    this.alt = alt;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-image-container';
    const img = document.createElement('img');
    img.src = this.url;
    img.alt = this.alt;
    img.title = this.alt;
    img.className = 'cm-image-preview';
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent() { return true; }
}

const imageDecorator = new MatchDecorator({
  regexp: /!\[(.*?)\]\((.*?)\)/g,
  decoration: (match) => {
    return Decoration.widget({
      widget: new ImageWidget(match[2], match[1]),
      side: 1
    });
  }
});

const imagePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = imageDecorator.createDeco(view); }
  update(update) { this.decorations = imageDecorator.updateDeco(update, this.decorations); }
}, { decorations: v => v.decorations });

// Custom underline highlight for <u> tags
const underlineDecorator = new MatchDecorator({
  regexp: /<u>(.*?)<\/u>/g,
  decoration: (match) => Decoration.mark({ class: 'cm-underline' })
});
const underlinePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = underlineDecorator.createDeco(view); }
  update(update) { this.decorations = underlineDecorator.updateDeco(update, this.decorations); }
}, { decorations: v => v.decorations });

function toggleFormatting(view, prefix, suffix = prefix) {
  const sel = view.state.selection.main;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  const isWrapped = selected.startsWith(prefix) && selected.endsWith(suffix);
  
  const inserted = isWrapped 
    ? selected.slice(prefix.length, -suffix.length) 
    : `${prefix}${selected}${suffix}`;
    
  view.dispatch({ 
    changes: { from: sel.from, to: sel.to, insert: inserted },
    selection: { anchor: sel.from, head: sel.from + inserted.length },
    scrollIntoView: true 
  });
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

export default function Editor({ ydoc, ytext, active, awareness, user, sendAwareness, onSelectionChange, canEdit = true }) {
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
        markdown({ base: markdownLanguage }),
        imagePlugin,
        underlinePlugin,
        EditorView.editable.of(canEdit),
        awareness ? yCollab(ytext, awareness, {
          user: { name: user?.name, color: '#30bced', colorLight: '#30bced33' },
        }) : [],
        EditorView.theme({
          '&': { 
            height: 'auto', 
            minHeight: '1056px',
            backgroundColor: '#fff',
            outline: 'none'
          },
          '.cm-scroller': {
            overflow: 'visible'
          },
          '.cm-content': { 
             padding: '0'
          },
          '.cm-gutters': { 
            display: 'none' 
          },
          '.cm-line': { 
            padding: '0' 
          },
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
            if (!coords) return;
            const parentRect = containerRef.current.getBoundingClientRect();
            const pos = { 
              top: coords.top - parentRect.top - 40, 
              left: coords.left - parentRect.left 
            };
            
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
  }, [active, ytext, ydoc, awareness, canEdit]);

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
    <div className={`cm-editor-wrap ${!canEdit ? 'read-only' : ''}`}>
      <div className="editor-toolbar" style={{ opacity: canEdit ? 1 : 0.6, pointerEvents: canEdit ? 'auto' : 'none' }}>
        <div style={{ display: 'flex', borderRight: '1px solid #ddd', paddingRight: 8, gap: 2 }}>
          <button className="toolbar-btn" onClick={withView((v) => undo(v))} title="Undo (Ctrl+Z)" disabled={!canEdit}>↶</button>
          <button className="toolbar-btn" onClick={withView((v) => redo(v))} title="Redo (Ctrl+Y)" disabled={!canEdit}>↷</button>
          <button className="toolbar-btn" onClick={() => window.print()} title="Print (Ctrl+P)">🖨️</button>
        </div>
        
        <div style={{ display: 'flex', borderRight: '1px solid #ddd', padding: '0 8px', gap: 2 }}>
          <select className="toolbar-select" style={{ width: 120 }} disabled={!canEdit}>
            <option>Normal text</option>
            <option>Heading 1</option>
            <option>Heading 2</option>
          </select>
          <select className="toolbar-select" style={{ width: 100 }} disabled={!canEdit}>
            <option>Arial</option>
            <option>Roboto</option>
          </select>
        </div>

        <div style={{ display: 'flex', borderRight: '1px solid #ddd', padding: '0 8px', gap: 2 }}>
          <button className="toolbar-btn" onClick={withView((v) => toggleFormatting(v, '**'))} title="Bold (Ctrl+B)" disabled={!canEdit}><b>B</b></button>
          <button className="toolbar-btn" onClick={withView((v) => toggleFormatting(v, '*'))} title="Italic (Ctrl+I)" disabled={!canEdit}><i>I</i></button>
          <button className="toolbar-btn" onClick={withView((v) => toggleFormatting(v, '<u>', '</u>'))} title="Underline (Ctrl+U)" disabled={!canEdit}><u>U</u></button>
          <button className="toolbar-btn" style={{ color: '#1a73e8' }} title="Text color" disabled={!canEdit}>A</button>
        </div>

        <div style={{ display: 'flex', gap: 2, paddingLeft: 8 }}>
          <button className="toolbar-btn" title="Left Align" disabled={!canEdit}>≡</button>
          <button className="toolbar-btn" title="Center Align" disabled={!canEdit}>⌸</button>
          <button className="toolbar-btn" title="Right Align" disabled={!canEdit}>⌹</button>
        </div>
      </div>
      <div ref={surfaceRef} className="editor-surface">
        <div ref={containerRef} className="cm-editor" />
      </div>
    </div>
  );
}
