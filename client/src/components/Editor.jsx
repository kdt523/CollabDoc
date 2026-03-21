import React, { useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { yCollab } from 'y-codemirror.next';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import '../styles/editor.css';

function hashToHslColor(userId) {
  let hash = 0;
  const s = String(userId);
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const color = `hsl(${hue}, 70%, 55%)`;
  const colorLight = `hsla(${hue}, 70%, 55%, 0.2)`;
  return { color, colorLight };
}

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

export default function Editor({ user, ytext, synced, awareness, sendAwareness }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const surfaceRef = useRef(null);

  const myColors = useMemo(() => {
    if (!user?.id) return { color: '#30bced', colorLight: '#30bced33' };
    return hashToHslColor(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!synced || !ytext || !awareness || !containerRef.current) return;

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        basicSetup,
        yCollab(ytext, awareness, {
          user: { name: user.name, color: myColors.color, colorLight: myColors.colorLight },
        }),
        EditorView.theme({
          '&': { backgroundColor: '#1e1e1e', color: '#e5e7eb' },
          '.cm-content': { caretColor: '#ffffff' },
          '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#9ca3af', border: 'none' },
          '.cm-line': { color: '#e5e7eb' },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.selectionSet) return;
          if (!awareness) return;

          const sel = update.state.selection.main;
          const anchorRel = Y.createRelativePositionFromTypeIndex(ytext, sel.anchor);
          const headRel = Y.createRelativePositionFromTypeIndex(ytext, sel.head);
          const cursor = {
            anchor: typeof anchorRel.toJSON === 'function' ? anchorRel.toJSON() : anchorRel,
            head: typeof headRel.toJSON === 'function' ? headRel.toJSON() : headRel,
          };
          sendAwareness(cursor, { anchor: sel.anchor, head: sel.head });
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    view.contentDOM.spellcheck = true;
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [synced, ytext, awareness, myColors.color, myColors.colorLight, sendAwareness, user?.name]);

  const withView = (fn) => () => {
    const view = viewRef.current;
    if (!view) return;
    fn(view);
  };

  if (!synced) {
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
        <button
          className="toolbar-btn"
          onClick={withView((v) => {
            v.contentDOM.spellcheck = !v.contentDOM.spellcheck;
          })}
          title="Toggle spellcheck"
        >
          A✓
        </button>
        <select
          className="toolbar-select"
          defaultValue="100"
          onChange={(e) => {
            const z = Number(e.target.value) / 100;
            if (surfaceRef.current) surfaceRef.current.style.setProperty('--editor-zoom', String(z));
          }}
          title="Zoom"
        >
          <option value="75">75%</option>
          <option value="100">100%</option>
          <option value="125">125%</option>
          <option value="150">150%</option>
        </select>
        <select
          className="toolbar-select"
          defaultValue="2"
          onChange={(e) => {
            const v = viewRef.current;
            if (!v) return;
            const level = Number(e.target.value);
            const line = v.state.doc.lineAt(v.state.selection.main.from);
            const content = line.text.replace(/^#{1,6}\s+/, '');
            const prefix = level === 0 ? '' : `${'#'.repeat(level)} `;
            v.dispatch({ changes: { from: line.from, to: line.to, insert: prefix + content } });
          }}
          title="Headings"
        >
          <option value="0">Normal text</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>
        <select
          className="toolbar-select"
          defaultValue="Roboto"
          onChange={(e) => {
            if (surfaceRef.current) surfaceRef.current.style.setProperty('--editor-font', e.target.value);
          }}
          title="Font"
        >
          <option>Roboto</option>
          <option>Arial</option>
          <option>Georgia</option>
          <option>Courier New</option>
        </select>
        <select
          className="toolbar-select"
          defaultValue="13"
          onChange={(e) => {
            if (surfaceRef.current) surfaceRef.current.style.setProperty('--editor-font-size', `${e.target.value}px`);
          }}
          title="Font size"
        >
          <option value="12">12</option>
          <option value="13">13</option>
          <option value="14">14</option>
          <option value="16">16</option>
          <option value="18">18</option>
        </select>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `**${t || 'bold'}**`))} title="Bold"><b>B</b></button>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `*${t || 'italic'}*`))} title="Italic"><i>I</i></button>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `<u>${t || 'underline'}</u>`))} title="Underline"><u>U</u></button>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `~~${t || 'strike'}~~`))} title="Strikethrough">S</button>
        <button
          className="toolbar-btn"
          onClick={withView((v) => {
            const selected = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) || 'link';
            const url = window.prompt('Enter URL', 'https://');
            if (!url) return;
            replaceSelection(v, () => `[${selected}](${url})`);
          })}
          title="Insert link"
        >
          🔗
        </button>
        <button className="toolbar-btn" onClick={withView((v) => applyPrefixToSelectedLines(v, () => '- '))} title="Bulleted list">•</button>
        <button className="toolbar-btn" onClick={withView((v) => applyPrefixToSelectedLines(v, (i) => `${i + 1}. `))} title="Numbered list">1.</button>
        <button className="toolbar-btn" onClick={withView((v) => applyPrefixToSelectedLines(v, () => '- [ ] '))} title="Checklist">☑</button>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `<div style="text-align:left">\n${t}\n</div>`))} title="Align left">≡</button>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `<div style="text-align:center">\n${t}\n</div>`))} title="Align center">≣</button>
        <button className="toolbar-btn" onClick={withView((v) => replaceSelection(v, (t) => `<div style="text-align:right">\n${t}\n</div>`))} title="Align right">☰</button>
      </div>
      <div ref={surfaceRef} className="editor-surface">
        <div ref={containerRef} className="cm-editor" />
      </div>
    </div>
  );
}

