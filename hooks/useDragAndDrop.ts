import { useRef, useCallback, useState, RefObject } from 'react';
import { Player, DragState } from '../types';

interface UseDragAndDropOptions {
  pitchRef: RefObject<HTMLDivElement | null>;
  players: Player[];
  onPositionUpdate: (id: string, x: number, y: number) => void;
  onSwapPlayers: (id1: string, id2: string) => void;
}

interface UseDragAndDropReturn {
  handleDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  isDragging: boolean;
  draggedId: string | null;
  dropTargetId: string | null;
}

// Distance threshold for detecting swap (percentage of pitch)
const SWAP_THRESHOLD = 8;

export function useDragAndDrop({
  pitchRef,
  players,
  onPositionUpdate,
  onSwapPlayers
}: UseDragAndDropOptions): UseDragAndDropReturn {
  const dragRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const startPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Find the closest player to a position (excluding the dragged player)
  const findClosestPlayer = useCallback((x: number, y: number, excludeId: string): string | null => {
    let closest: { id: string; distance: number } | null = null;

    for (const player of players) {
      if (player.id === excludeId) continue;

      const dx = player.position.x - x;
      const dy = player.position.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < SWAP_THRESHOLD && (!closest || distance < closest.distance)) {
        closest = { id: player.id, distance };
      }
    }

    return closest?.id || null;
  }, [players]);

  const handleDragStart = useCallback((id: string, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    // Store the starting position of the dragged player
    const draggedPlayer = players.find(p => p.id === id);
    if (draggedPlayer) {
      startPositionRef.current = { ...draggedPlayer.position };
    }

    dragRef.current = { id, startX: clientX, startY: clientY };
    setIsDragging(true);
    setDraggedId(id);

    // Add haptic feedback on mobile if available
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      moveEvent.preventDefault();
      if (!dragRef.current || !pitchRef.current) return;

      const moveClientX = 'touches' in moveEvent
        ? moveEvent.touches[0].clientX
        : (moveEvent as MouseEvent).clientX;
      const moveClientY = 'touches' in moveEvent
        ? moveEvent.touches[0].clientY
        : (moveEvent as MouseEvent).clientY;

      const pitchRect = pitchRef.current.getBoundingClientRect();
      let newX = ((moveClientX - pitchRect.left) / pitchRect.width) * 100;
      let newY = ((moveClientY - pitchRect.top) / pitchRect.height) * 100;

      // Clamp to pitch boundaries
      newX = Math.max(2, Math.min(98, newX));
      newY = Math.max(5, Math.min(95, newY));

      onPositionUpdate(dragRef.current.id, newX, newY);

      // Check for potential swap target
      const targetId = findClosestPlayer(newX, newY, dragRef.current.id);
      setDropTargetId(targetId);
    };

    const handleEnd = (endEvent: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return;

      const currentDragId = dragRef.current.id;
      const currentDropTarget = dropTargetId;

      // If we have a drop target, swap the players
      if (currentDropTarget) {
        onSwapPlayers(currentDragId, currentDropTarget);

        // Haptic feedback on successful swap
        if ('vibrate' in navigator) {
          navigator.vibrate([20, 50, 20]);
        }
      }

      // Reset state
      dragRef.current = null;
      startPositionRef.current = null;
      setIsDragging(false);
      setDraggedId(null);
      setDropTargetId(null);

      // Clean up event listeners
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };

    // Add event listeners
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);
  }, [pitchRef, players, onPositionUpdate, onSwapPlayers, findClosestPlayer, dropTargetId]);

  return {
    handleDragStart,
    isDragging,
    draggedId,
    dropTargetId,
  };
}
