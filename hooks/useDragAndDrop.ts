import { useRef, useCallback, useState, RefObject } from 'react';
import { Player } from '../types';

interface UseDragAndDropOptions {
  pitchRef: RefObject<HTMLDivElement | null>;
  players: Player[];
  onSwapPlayers: (id1: string, id2: string) => void;
}

interface UseDragAndDropReturn {
  handleDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  isDragging: boolean;
  draggedId: string | null;
  dropTargetId: string | null;
}

// Distance threshold for detecting swap (percentage of pitch)
const SWAP_THRESHOLD = 12;

export function useDragAndDrop({
  pitchRef,
  players,
  onSwapPlayers
}: UseDragAndDropOptions): UseDragAndDropReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const dropTargetIdRef = useRef<string | null>(null);

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

    console.log('[DragDrop] Drag started:', id);
    draggedIdRef.current = id;
    setIsDragging(true);
    setDraggedId(id);

    // Add haptic feedback on mobile if available
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      moveEvent.preventDefault();
      if (!draggedIdRef.current || !pitchRef.current) return;

      const moveClientX = 'touches' in moveEvent
        ? moveEvent.touches[0].clientX
        : (moveEvent as MouseEvent).clientX;
      const moveClientY = 'touches' in moveEvent
        ? moveEvent.touches[0].clientY
        : (moveEvent as MouseEvent).clientY;

      const pitchRect = pitchRef.current.getBoundingClientRect();
      const x = ((moveClientX - pitchRect.left) / pitchRect.width) * 100;
      const y = ((moveClientY - pitchRect.top) / pitchRect.height) * 100;

      // Check for potential swap target
      const targetId = findClosestPlayer(x, y, draggedIdRef.current);
      if (targetId !== dropTargetIdRef.current) {
        console.log('[DragDrop] Drop target changed:', targetId, 'at position:', { x: x.toFixed(1), y: y.toFixed(1) });
      }
      dropTargetIdRef.current = targetId;
      setDropTargetId(targetId);
    };

    const handleEnd = () => {
      const currentDragId = draggedIdRef.current;
      const currentDropTarget = dropTargetIdRef.current;

      console.log('[DragDrop] Drag ended. Dragged:', currentDragId, 'Target:', currentDropTarget);

      // If we have a drop target, swap the players
      if (currentDragId && currentDropTarget) {
        console.log('[DragDrop] Swapping players:', currentDragId, '<->', currentDropTarget);
        onSwapPlayers(currentDragId, currentDropTarget);

        // Haptic feedback on successful swap
        if ('vibrate' in navigator) {
          navigator.vibrate([20, 50, 20]);
        }
      } else {
        console.log('[DragDrop] No swap - missing drag or target');
      }

      // Reset state
      draggedIdRef.current = null;
      dropTargetIdRef.current = null;
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
  }, [pitchRef, findClosestPlayer, onSwapPlayers]);

  return {
    handleDragStart,
    isDragging,
    draggedId,
    dropTargetId,
  };
}
