
import React, { useState, useRef, useEffect } from 'react';
import { Player } from '../types';
import ShirtIcon from './ShirtIcon';

interface DragPosition {
  x: number;
  y: number;
}

interface PlayerNodeProps {
  player: Player;
  onUpdateName: (id: string, newName: string) => void;
  onDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  showRatings?: boolean;
  isBeingDragged?: boolean;
  isDropTarget?: boolean;
  dragPosition?: DragPosition | null;
}

const PlayerNode: React.FC<PlayerNodeProps> = ({
  player,
  onUpdateName,
  onDragStart,
  showRatings = true,
  isBeingDragged = false,
  isDropTarget = false,
  dragPosition = null,
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

  // Calculate display position - use drag position if being dragged, otherwise fixed position
  const displayX = isBeingDragged && dragPosition ? dragPosition.x : player.position.x;
  const displayY = isBeingDragged && dragPosition ? dragPosition.y : player.position.y;

  return (
    <>
      {/* Ghost placeholder at original position when dragging */}
      {isBeingDragged && (
        <div
          className="absolute flex flex-col items-center select-none pointer-events-none z-10 opacity-30"
          style={{
            left: `${player.position.x}%`,
            top: `${player.position.y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="relative">
            <ShirtIcon color={player.team} className="w-20 h-20 md:w-24 md:h-24 grayscale" />
          </div>
          <div className="mt-1 text-sm md:text-xl font-black tracking-tighter text-white/20 px-3 py-0.5 rounded-md uppercase italic">
            {player.name || "ADD"}
          </div>
        </div>
      )}

      {/* Main player node */}
      <div
        className={`absolute flex flex-col items-center select-none ${
          isBeingDragged
            ? 'z-50 pointer-events-none'
            : isDropTarget
            ? 'z-40'
            : 'z-20'
        }`}
        style={{
          left: `${displayX}%`,
          top: `${displayY}%`,
          transform: 'translate(-50%, -50%)',
          cursor: isEditing ? 'text' : 'grab',
          transition: isBeingDragged ? 'none' : 'left 0.3s ease-out, top 0.3s ease-out',
        }}
        onMouseDown={(e) => !isEditing && onDragStart(player.id, e)}
        onTouchStart={(e) => !isEditing && onDragStart(player.id, e)}
      >
        {/* Drop target glow effect */}
        {isDropTarget && (
          <div
            className="absolute rounded-full bg-emerald-400/30 animate-ping pointer-events-none"
            style={{
              width: '120px',
              height: '120px',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}

        {/* Drop target ring */}
        {isDropTarget && (
          <div
            className="absolute rounded-full border-4 border-emerald-400 pointer-events-none"
            style={{
              width: '100px',
              height: '100px',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}

        <div className={`relative group transition-transform duration-150 ${
          isBeingDragged ? 'scale-110' : ''
        } ${isDropTarget ? 'scale-115' : ''}`}>

          {/* Shadow - larger when dragging */}
          <div className={`absolute left-1/2 -translate-x-1/2 bg-black/40 blur-md rounded-full pointer-events-none transition-all duration-150 ${
            isBeingDragged
              ? 'w-16 h-6 -bottom-3 opacity-60'
              : 'w-12 h-4 -bottom-1 scale-y-50'
          }`} />

          {/* Shirt */}
          <ShirtIcon
            color={player.team}
            className={`w-20 h-20 md:w-24 md:h-24 relative z-10 transition-all duration-150 ${
              isDropTarget ? 'brightness-125' : ''
            } ${isBeingDragged ? 'drop-shadow-2xl' : ''}`}
          />

          {/* Swap icon when drop target */}
          {isDropTarget && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <div className="bg-emerald-500 rounded-full p-2 shadow-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </div>
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
              onClick={(e) => {
                e.stopPropagation();
                if (!isBeingDragged) setIsEditing(true);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className={`text-sm md:text-xl font-black tracking-tighter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] transition-all px-3 py-0.5 rounded-md uppercase italic ${
                player.name
                ? 'text-white bg-black/50 backdrop-blur-sm border border-white/10'
                : 'text-white/30 bg-white/5 border border-dashed border-white/20'
              } ${isDropTarget ? 'bg-emerald-500/40 border-emerald-400 text-emerald-100' : ''} ${
                isBeingDragged ? '' : 'cursor-pointer hover:scale-105'
              }`}
            >
              {player.name || "TAP"}
              {player.name && !player.rating && (
                <span className="ml-1 text-[8px] text-amber-400 not-italic font-bold align-top">+1</span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default PlayerNode;
