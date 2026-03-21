import React, { useState, useMemo } from 'react';
import MentionInput from './MentionInput';
import { useMentions } from '../hooks/useMentions';

export default function ChatPanel({ 
  messages, 
  ephemeralMsgs, 
  threads, 
  peers, 
  user,
  onSend,
  onGoToThread,
  onResolveThread
}) {
  const [activeTab, setActiveTab] = useState('persistent');
  const { parseText, filterByRole, mentionSuggestions } = useMentions(peers);

  const filteredMessages = useMemo(() => {
    return filterByRole(messages, user.role, user.id);
  }, [messages, user.role, user.id, filterByRole]);

  const sortedThreads = useMemo(() => {
    const list = Array.from(threads.values());
    const conflicts = list.filter(t => t.triggerType === 'conflict' && !t.resolved);
    const manual = list.filter(t => t.triggerType === 'manual' && !t.resolved);
    const resolved = list.filter(t => t.resolved);
    return { conflicts, manual, resolved };
  }, [threads]);

  const Message = ({ msg, type = 'persistent' }) => {
    const { parsed } = parseText(msg.text);
    return (
      <div className={`chat-message ${type === 'ephemeral' ? 'ephemeral' : ''}`}>
        <div className="msg-header">
          <span className="author" style={{ color: msg.authorColor }}>{msg.authorName}</span>
          <span className="time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="msg-body">{parsed}</div>
      </div>
    );
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="tab-bar">
          <button className={activeTab === 'persistent' ? 'active' : ''} onClick={() => setActiveTab('persistent')}>Persistent</button>
          <button className={activeTab === 'ephemeral' ? 'active' : ''} onClick={() => setActiveTab('ephemeral')}>Live</button>
          <button className={activeTab === 'threads' ? 'active' : ''} onClick={() => setActiveTab('threads')}>Threads</button>
        </div>
      </div>

      <div className="chat-body">
        {activeTab === 'persistent' && (
          <div className="msg-list">
            {filteredMessages.map(msg => <Message key={msg.id} msg={msg} />)}
            {filteredMessages.length === 0 && <div className="empty-state">No messages here.</div>}
          </div>
        )}
        
        {activeTab === 'ephemeral' && (
          <div className="msg-list">
            <div className="banner ephemeral">Live only — not saved</div>
            {ephemeralMsgs.map(msg => <Message key={msg.id} msg={msg} type="ephemeral" />)}
            {ephemeralMsgs.length === 0 && <div className="empty-state">No active live discussion.</div>}
          </div>
        )}

        {activeTab === 'threads' && (
          <div className="thread-list">
            {sortedThreads.conflicts.length > 0 && (
              <section>
                <h4>Conflicts</h4>
                {sortedThreads.conflicts.map(t => (
                  <div key={t.id} className="thread-row conflict">
                    <span className="dot" />
                    <div className="content">
                      <div className="title">{t.title}</div>
                      <div className="meta">{t.replies ? t.replies.length : 0} replies</div>
                    </div>
                    <button onClick={() => onGoToThread(t)}>Go to</button>
                  </div>
                ))}
              </section>
            )}
            
            <section>
              <h4>Manual Annotations</h4>
              {sortedThreads.manual.map(t => (
                <div key={t.id} className="thread-row manual">
                  <span className="dot" />
                  <div className="content">
                    <div className="title">{t.title}</div>
                    <div className="meta">{t.replies ? t.replies.length : 0} replies</div>
                  </div>
                  <button onClick={() => onGoToThread(t)}>Go to</button>
                </div>
              ))}
              {sortedThreads.manual.length === 0 && <div className="empty-state">No active threads.</div>}
            </section>
          </div>
        )}
      </div>

      {(activeTab === 'persistent' || activeTab === 'ephemeral') && (
        <div className="chat-footer">
          <MentionInput 
            suggestions={mentionSuggestions}
            onSend={(data) => onSend({ ...data, mode: activeTab === 'ephemeral' ? 'ephemeral' : 'persistent' })}
            placeholder={activeTab === 'ephemeral' ? 'Start a live discussion...' : 'Message collaborators...'}
          />
        </div>
      )}
    </div>
  );
}
