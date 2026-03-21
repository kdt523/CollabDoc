import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';

export function useAnnotations(ydoc) {
  const [annotations, setAnnotations] = useState([]);

  useEffect(() => {
    if (!ydoc) return;

    const annotationsMap = ydoc.getMap('annotations');
    const ytext = ydoc.getText('codemirror');

    const updateAnnotations = () => {
      const newAnns = [];
      annotationsMap.forEach((ann) => {
        const annJson = ann.toJSON();
        const startRel = Y.createRelativePositionFromJSON(annJson.anchor.start);
        const endRel = Y.createRelativePositionFromJSON(annJson.anchor.end);
        
        const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, ydoc);
        const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, ydoc);
        
        if (startAbs && endAbs) {
          newAnns.push({
            ...annJson,
            resolvedAnchor: { from: startAbs.index, to: endAbs.index }
          });
        }
      });
      setAnnotations(newAnns);
    };

    annotationsMap.observe(updateAnnotations);
    ytext.observe(updateAnnotations);
    
    updateAnnotations();

    return () => {
      annotationsMap.unobserve(updateAnnotations);
      ytext.unobserve(updateAnnotations);
    };
  }, [ydoc]);

  const resolveAnchorToIndex = useCallback((anchorJSON) => {
    if (!ydoc) return null;
    const relPos = Y.createRelativePositionFromJSON(anchorJSON);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);
    return absPos ? absPos.index : null;
  }, [ydoc]);

  return {
    annotations,
    resolveAnchorToIndex
  };
}
