
import React, { useState, useRef, useEffect } from 'react';
import { Player } from '../types';
import ShirtIcon from './ShirtIcon';

interface PlayerNodeProps {
  player: Player;
  onUpdateName: (id: string, newName: string) => void;
  onDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  showRatings?: boolean;
  isBeingDragged?: boolean;
  isDropTarget?: boolean;
}

const PlayerNode: React.FC<PlayerNodeProps> = ({
  player,
  onUpdateName,
  onDragStart,
  showRatings = true,
  isBeingDragged = false,
  isDropTarget = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(player.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Sync edit value when player name changes externally (e.g., after swap)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(player.name);
    }
  }, [player.name, isEditing]);

  const handleSubmit = () => {
    onUpdateName(player.id, editValue);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') {
      setEditValue(player.name);
      setIsEditing(false);
    }
  };

  const getRatingColor = (rating?: number) => {
    if (!rating) return 'bg-slate-700';
    if (rating >= 85) return 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]';
    if (rating >= 75) return 'bg-emerald-500';
    return 'bg-blue-500';
  };

  return (
    <div
      className={`absolute flex flex-col items-center select-none transition-transform duration-75 ${
        isBeingDragged ? 'z-50 scale-110' : 'z-20'
      } ${isDropTarget ? 'z-40' : ''}`}
      style={{
        left: `${player.position.x}%`,
        top: `${player.position.y}%`,
        transform: `translate(-50%, -50%) ${isBeingDragged ? 'scale(1.1)' : ''} ${isDropTarget ? 'scale(1.15)' : ''}`,
        cursor: isEditing ? 'text' : 'grab',
      }}
      onMouseDown={(e) => !isEditing && onDragStart(player.id, e)}
      onTouchStart={(e) => !isEditing && onDragStart(player.id, e)}
    >
      {/* Drop target indicator ring */}
      {isDropTarget && (
        <div className="absolute inset-0 -m-4 rounded-full border-4 border-emerald-400 border-dashed animate-pulse bg-emerald-400/20 pointer-events-none"
          style={{ width: 'calc(100% + 2rem)', height: 'calc(100% + 2rem)', left: '-1rem', top: '-0.5rem' }}
        />
      )}

      {/* Dragging indicator */}
      {isBeingDragged && (
        <div className="absolute inset-0 -m-2 rounded-full bg-white/10 blur-md pointer-events-none"
          style={{ width: 'calc(100% + 1rem)', height: 'calc(100% + 1rem)', left: '-0.5rem', top: '-0.25rem' }}
        />
      )}

      <div className={`relative group transition-all duration-150 ${isBeingDragged ? 'drop-shadow-2xl' : ''}`}>
        {/* Rating Badge */}
        {showRatings && player.rating && (
          <div className={`absolute -top-1 -right-1 z-30 ${getRatingColor(player.rating)} text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-slate-900 shadow-lg animate-in zoom-in duration-300`}>
            {player.rating}
          </div>
        )}

        {/* Shadow */}
        <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-12 h-4 bg-black/40 blur-md rounded-full pointer-events-none transition-transform ${
          isBeingDragged ? 'scale-150 opacity-60' : 'scale-y-50'
        }`} />

        {/* Shirt */}
        <ShirtIcon
          color={player.team}
          className={`w-20 h-20 md:w-24 md:h-24 relative z-10 transition-all duration-150 ${
            isDropTarget ? 'brightness-125 saturate-150' : ''
          } ${isBeingDragged ? 'brightness-110' : ''}`}
        />

        {/* Swap hint arrow when drop target */}
        {isDropTarget && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-emerald-400 animate-bounce">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v10.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </div>

      <div className="mt-1 flex flex-col items-center w-full z-30">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={handleKeyDown}
            className="bg-black text-white text-center rounded-lg px-3 py-1 text-base md:text-xl font-black border-2 border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.6)] focus:outline-none min-w-[100px]"
          />
        ) : (
          <div
            onClick={() => setIsEditing(true)}
            className={`text-sm md:text-xl font-black tracking-tighter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] transition-all cursor-pointer px-3 py-0.5 rounded-md uppercase italic ${
              player.name
              ? 'text-white bg-black/50 backdrop-blur-sm border border-white/10'
              : 'text-white/30 bg-white/5 border border-dashed border-white/20'
            } ${isDropTarget ? 'bg-emerald-500/30 border-emerald-400' : ''} ${isBeingDragged ? 'opacity-70' : 'hover:scale-110'}`}
          >
            {player.name || "ADD"}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerNode;
