import React, { useState, useEffect, useRef } from 'react';

export default function MentionInput({ value, onChange, onSend, suggestions, placeholder, mode = 'persistent' }) {
  const [text, setText] = useState(value || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [query, setQuery] = useState('');
  const [filtered, setFiltered] = useState([]);
  const [cursorPos, setCursorPos] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (showSuggestions) {
      const matches = suggestions.filter(s => 
        s.name.toLowerCase().startsWith(query.toLowerCase())
      );
      setFiltered(matches);
    }
  }, [showSuggestions, query, suggestions]);

  const handleKeyDown = (e) => {
    if (e.key === '@') {
      setShowSuggestions(true);
      setQuery('');
      setCursorPos(e.target.selectionStart + 1);
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (showSuggestions && filtered.length > 0 && e.key === 'Enter') {
        e.preventDefault();
        applyMention(filtered[0]);
      } else {
        setShowSuggestions(false);
      }
    } else if (e.key === 'Backspace' && showSuggestions && query === '') {
      setShowSuggestions(false);
    }
    
    if (e.key === 'Enter' && !e.shiftKey && !showSuggestions) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e) => {
    const val = e.target.value;
    setText(val);
    if (showSuggestions) {
      const currentPos = e.target.selectionStart;
      const q = val.substring(cursorPos, currentPos);
      setQuery(q);
    }
  };

  const applyMention = (user) => {
    const before = text.substring(0, cursorPos - 1);
    const after = text.substring(inputRef.current.selectionStart);
    const newText = `${before}@${user.name} ${after}`;
    setText(newText);
    setShowSuggestions(false);
    inputRef.current.focus();
  };

  const handleSubmit = () => {
    if (!text.trim()) return;
    
    // Extract mentioned userIds
    const mentions = [];
    const parts = text.split(/(@\w+)/g);
    parts.forEach(part => {
      if (part.startsWith('@')) {
        const name = part.substring(1);
        const user = suggestions.find(s => s.name === name);
        if (user) mentions.push(user.id);
      }
    });

    onSend({ text, mentions, mode });
    setText('');
  };

  return (
    <div className="mention-input-container">
      {showSuggestions && filtered.length > 0 && (
        <ul className="mention-suggestions">
          {filtered.map(user => (
            <li key={user.id} onClick={() => applyMention(user)}>
              {user.name}
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={inputRef}
        className="mention-input"
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
      />
      <button className="send-btn" onClick={handleSubmit}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      </button>
    </div>
  );
}
