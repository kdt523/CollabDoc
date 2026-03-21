import React from 'react';

export default function AnnotationGutter({ 
  annotations, 
  editorView, 
  onAnnotationClick 
}) {
  if (!editorView || !annotations || annotations.length === 0) return null;

  const markers = annotations.map(ann => {
    const { from } = ann.resolvedAnchor;
    const line = editorView.state.doc.lineAt(from);
    const coords = editorView.coordsAtPos(line.from);
    const editorRect = editorView.dom.getBoundingClientRect();

    if (!coords) return null;
    
    // Relative top to editor container
    const top = coords.top - editorRect.top;

    return (
      <div 
        key={ann.id} 
        className={`annotation-marker ${ann.triggerType || 'manual'}`}
        style={{ top }}
        onClick={() => onAnnotationClick(ann)}
        title={ann.title || 'Annotation'}
      />
    );
  }).filter(Boolean);

  return (
    <div className="annotation-gutter">
      {markers}
    </div>
  );
}
