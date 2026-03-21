import React, { useMemo } from 'react';

export default function ConflictThread({ thread, users, onResolve }) {
  const replies = useMemo(() => thread.replies || [], [thread.replies]);

  return (
    <div className="conflict-thread">
      <div className="conflict-banner">
        <span className="icon">⚡</span>
        <span className="msg">Conflict detected between {users.join(' and ')}</span>
      </div>

      <div className="thread-replies">
        {replies.map((reply, i) => (
          <div key={reply.id || i} className="reply">
            <span className="author">{reply.authorName}</span>
            <span className="text">{reply.text}</span>
            <span className="time">{new Date(reply.timestamp).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>

      <div className="actions">
        <button onClick={() => onResolve(thread.id)}>Mark Resolved</button>
      </div>
    </div>
  );
}
