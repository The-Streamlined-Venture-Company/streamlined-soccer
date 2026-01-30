import { useRef, useCallback, useState, RefObject } from 'react';
import { Player, DragState } from '../types';

interface UseDragAndDropOptions {
  pitchRef: RefObject<HTMLDivElement | null>;
  onPositionUpdate: (id: string, x: number, y: number) => void;
}

interface UseDragAndDropReturn {
  handleDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  isDragging: boolean;
  draggedId: string | null;
}

export function useDragAndDrop({ pitchRef, onPositionUpdate }: UseDragAndDropOptions): UseDragAndDropReturn {
  const dragRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const handleDragStart = useCallback((id: string, e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    dragRef.current = { id, startX: clientX, startY: clientY };
    setIsDragging(true);
    setDraggedId(id);

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
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
    };

    const handleEnd = () => {
      dragRef.current = null;
      setIsDragging(false);
      setDraggedId(null);

      // Clean up event listeners
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };

    // Add event listeners
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
  }, [pitchRef, onPositionUpdate]);

  return {
    handleDragStart,
    isDragging,
    draggedId,
  };
}
