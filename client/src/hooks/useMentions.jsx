import React, { useState, useMemo, useCallback } from 'react';

export function useMentions(peers, collaborators) {
  const mentionSuggestions = useMemo(() => {
    const list = [...(peers || [])];
    (collaborators || []).forEach(c => {
      if (!list.some(p => p.id === c.id)) {
        list.push({ id: c.id, name: c.name });
      }
    });
    return list;
  }, [peers, collaborators]);

  const parseText = useCallback((text) => {
    const parts = text.split(/(@\w+)/g);
    const mentionedUserIds = [];
    
    const parsed = parts.map((part, i) => {
      if (part.startsWith('@')) {
        const name = part.substring(1);
        const user = mentionSuggestions.find(u => u.name === name);
        if (user) {
          mentionedUserIds.push(user.id);
          return <span key={i} className="mention">{part}</span>;
        }
      }
      return part;
    });

    return { parsed, mentionedUserIds };
  }, [mentionSuggestions]);

  const filterByRole = useCallback((messages, userRole, currentUserId) => {
    if (userRole === 'viewer') {
      return messages.filter(m => {
        const mentions = m.mentions || [];
        return mentions.length === 0 || mentions.includes(currentUserId);
      });
    }
    return messages;
  }, []);

  return {
    parseText,
    filterByRole,
    mentionSuggestions
  };
}
