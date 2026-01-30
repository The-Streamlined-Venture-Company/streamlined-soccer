
import React, { useState, useRef, useEffect } from 'react';
import { Player } from '../types';
import ShirtIcon from './ShirtIcon';

interface PlayerNodeProps {
  player: Player;
  onUpdateName: (id: string, newName: string) => void;
  onDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  showRatings?: boolean;
}

const PlayerNode: React.FC<PlayerNodeProps> = ({ player, onUpdateName, onDragStart, showRatings = true }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(player.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

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
      className="absolute flex flex-col items-center select-none"
      style={{ 
        left: `${player.position.x}%`, 
        top: `${player.position.y}%`,
        transform: 'translate(-50%, -50%)',
        cursor: isEditing ? 'text' : 'grab',
        zIndex: isEditing ? 100 : 20
      }}
      onMouseDown={(e) => !isEditing && onDragStart(player.id, e)}
      onTouchStart={(e) => !isEditing && onDragStart(player.id, e)}
    >
      <div className="relative group transition-all duration-300 active:scale-110">
        {/* Rating Badge - Hidden if showRatings is false */}
        {showRatings && player.rating && (
          <div className={`absolute -top-1 -right-1 z-30 ${getRatingColor(player.rating)} text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-slate-900 shadow-lg animate-in zoom-in duration-300`}>
            {player.rating}
          </div>
        )}

        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-12 h-4 bg-black/40 blur-md rounded-full scale-y-50 pointer-events-none group-active:scale-x-125 transition-transform" />
        
        <ShirtIcon color={player.team} className="w-20 h-20 md:w-24 md:h-24 relative z-10" />
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
            className={`text-sm md:text-xl font-black tracking-tighter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] hover:scale-110 transition-transform cursor-pointer px-3 py-0.5 rounded-md uppercase italic ${
              player.name 
              ? 'text-white bg-black/50 backdrop-blur-sm border border-white/10' 
              : 'text-white/30 bg-white/5 border border-dashed border-white/20'
            }`}
          >
            {player.name || "ADD"}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerNode;
