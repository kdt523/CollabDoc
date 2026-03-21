import React, { useState, useEffect, useMemo } from 'react';

export default function ReplayTimeline({ 
  events, 
  replayIndex, 
  isReplaying,
  onStepTo, 
  onStart, 
  onStop 
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let timer;
    if (isPlaying && replayIndex < events.length - 1) {
      timer = setTimeout(() => {
        onStepTo(replayIndex + 1);
      }, 800);
    } else if (replayIndex >= events.length - 1) {
      setIsPlaying(false);
    }
    return () => clearTimeout(timer);
  }, [isPlaying, replayIndex, events, onStepTo]);

  const markers = useMemo(() => {
    return events.map((event, i) => {
      let type = 'update';
      if (event.event_type === 'chat:message') type = 'chat';
      else if (event.event_type === 'conflict:detected') type = 'conflict';
      
      const pos = (i / (events.length - 1)) * 100;
      return (
        <div 
          key={event.id || i}
          className={`timeline-marker ${type}`}
          style={{ left: `${pos}%` }}
        />
      );
    });
  }, [events]);

  const currentEvent = events[replayIndex];

  return (
    <div className="replay-timeline">
      <div className="scrubber-container">
        <input 
          type="range" 
          min="0" 
          max={events.length > 0 ? events.length - 1 : 0} 
          value={replayIndex}
          onChange={(e) => onStepTo(parseInt(e.target.value, 10))}
          className="scrubber"
        />
        <div className="marker-track">
          {markers}
        </div>
      </div>

      <div className="controls">
        <button className="play-btn" onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        
        <div className="event-info">
          <span className="time">{currentEvent ? new Date(currentEvent.created_at).toLocaleString() : ''}</span>
          <span className="divider">|</span>
          <span className="actor">{currentEvent?.actor_name}</span>
          <span className="type">{currentEvent?.event_type}</span>
        </div>

        <button className="exit-btn" onClick={onStop}>Exit Replay</button>
      </div>
      
      <div className="replay-banner">
        <span>Replay mode — you are viewing history</span>
      </div>
    </div>
  );
}
