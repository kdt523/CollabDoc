import React, { useState } from 'react';
import MentionInput from './MentionInput';

export default function ThreadPopover({ 
  position, 
  thread, 
  onComment, 
  onReply, 
  onResolve, 
  onClose,
  suggestions
}) {
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [isCreating, setIsCreating] = useState(!thread);

  const handleComment = () => {
    if (newThreadTitle.trim()) {
      onComment(newThreadTitle);
      setNewThreadTitle('');
    }
  };

  const handleReply = (data) => {
    onReply(thread.id, data);
  };

  return (
    <div 
      className="thread-popover" 
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="close-popover" onClick={onClose}>×</button>
      
      {isCreating ? (
        <div className="new-thread-form">
          <h4>Add Annotation</h4>
          <input 
            type="text" 
            id="thread-title-input"
            name="thread-title-input"
            value={newThreadTitle} 
            onChange={(e) => setNewThreadTitle(e.target.value)}
            placeholder="Anchor name (e.g., 'Fix typo')"
          />
          <button onClick={handleComment}>Comment on selection</button>
        </div>
      ) : (
        <div className="thread-content">
          <h4>{thread.title}</h4>
          <div className="reply-list">
            {(thread.replies || []).map((reply, i) => (
              <div key={reply.id || i} className="reply-item">
                <span className="author">{reply.authorName}</span>
                <span className="text">{reply.text}</span>
              </div>
            ))}
          </div>
          <MentionInput 
            suggestions={suggestions}
            onSend={handleReply}
            placeholder="Reply to thread..."
          />
          <button className="resolve-btn" onClick={() => onResolve(thread.id)}>Mark Resolved</button>
        </div>
      )}
    </div>
  );
}
