import { useState, useCallback, RefObject } from 'react';
import { flushSync } from 'react-dom';
import { toPng, toBlob } from 'html-to-image';

interface UseImageExportOptions {
  pitchRef: RefObject<HTMLDivElement | null>;
  backgroundColor?: string;
}

interface UseImageExportReturn {
  exportAsImage: (beforeExport?: () => void, afterExport?: () => void) => Promise<void>;
  shareAsImage: (beforeExport?: () => void, afterExport?: () => void) => Promise<void>;
  copyToClipboard: (beforeExport?: () => void, afterExport?: () => void) => Promise<void>;
  isExporting: boolean;
  canShare: boolean;
  canCopyImage: boolean;
}

// Check if Web Share API with files is supported
const canShareFiles = (): boolean => {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  return typeof navigator.canShare === 'function';
};

// Check if clipboard API supports writing images
const canWriteImageToClipboard = (): boolean => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  return typeof ClipboardItem !== 'undefined';
};

export function useImageExport({ pitchRef, backgroundColor = '#020617' }: UseImageExportOptions): UseImageExportReturn {
  const [isExporting, setIsExporting] = useState(false);

  const finishExport = useCallback((afterExport?: () => void) => {
    flushSync(() => {
      setIsExporting(false);
      if (afterExport) {
        afterExport();
      }
    });
  }, []);

  // Download as file
  const exportAsImage = useCallback(async (
    beforeExport?: () => void,
    afterExport?: () => void
  ) => {
    console.log('[Export] exportAsImage called');
    if (!pitchRef.current) {
      console.error('[Export] pitchRef.current is null!');
      return;
    }

    flushSync(() => {
      setIsExporting(true);
      if (beforeExport) beforeExport();
    });

    try {
      console.log('[Export] Starting toPng...');
      const dataUrl = await toPng(pitchRef.current, {
        pixelRatio: 2,
        backgroundColor,
      });
      console.log('[Export] toPng completed');

      const link = document.createElement('a');
      link.download = `squad-lineup-${new Date().getTime()}.png`;
      link.href = dataUrl;
      link.click();
      console.log('[Export] Download triggered');
    } catch (err) {
      console.error('[Export] Export failed:', err);
    } finally {
      finishExport(afterExport);
    }
  }, [pitchRef, backgroundColor, finishExport]);

  // Share via Web Share API (WhatsApp, etc.)
  const shareAsImage = useCallback(async (
    beforeExport?: () => void,
    afterExport?: () => void
  ) => {
    console.log('[Share] shareAsImage called');
    if (!pitchRef.current) {
      console.error('[Share] pitchRef.current is null!');
      return;
    }

    flushSync(() => {
      setIsExporting(true);
      if (beforeExport) beforeExport();
    });

    try {
      console.log('[Share] Starting toBlob...');
      const blob = await toBlob(pitchRef.current, {
        pixelRatio: 2,
        backgroundColor,
      });

      if (!blob) {
        throw new Error('Failed to create blob');
      }
      console.log('[Share] Blob created, size:', blob.size);

      const file = new File([blob], 'squad-lineup.png', { type: 'image/png' });
      const shareData = {
        files: [file],
        title: 'Squad Lineup',
        text: 'Check out my team lineup!',
      };

      console.log('[Share] navigator.share:', !!navigator.share);
      console.log('[Share] navigator.canShare:', !!navigator.canShare);

      if (navigator.canShare && navigator.canShare(shareData)) {
        console.log('[Share] Sharing with files...');
        await navigator.share(shareData);
        console.log('[Share] Share completed');
      } else if (navigator.share) {
        console.log('[Share] Sharing without files (text only)...');
        await navigator.share({
          title: 'Squad Lineup',
          text: 'Check out my team lineup!',
        });
      } else {
        console.log('[Share] No share API, falling back to download...');
        const dataUrl = await toPng(pitchRef.current, {
          pixelRatio: 2,
          backgroundColor,
        });
        const link = document.createElement('a');
        link.download = `squad-lineup-${new Date().getTime()}.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('[Share] Share failed:', err);
      } else {
        console.log('[Share] User cancelled');
      }
    } finally {
      finishExport(afterExport);
    }
  }, [pitchRef, backgroundColor, finishExport]);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (
    beforeExport?: () => void,
    afterExport?: () => void
  ) => {
    console.log('[Clipboard] copyToClipboard called');
    if (!pitchRef.current) {
      console.error('[Clipboard] pitchRef.current is null!');
      return;
    }

    flushSync(() => {
      setIsExporting(true);
      if (beforeExport) beforeExport();
    });

    try {
      console.log('[Clipboard] Starting toBlob...');
      const blob = await toBlob(pitchRef.current, {
        pixelRatio: 2,
        backgroundColor,
      });

      if (!blob) {
        throw new Error('Failed to create blob');
      }
      console.log('[Clipboard] Blob created, size:', blob.size);

      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      console.log('[Clipboard] Copy successful!');

    } catch (err) {
      console.error('[Clipboard] Copy to clipboard failed:', err);
      // Fallback: download instead
      console.log('[Clipboard] Falling back to download...');
      try {
        const dataUrl = await toPng(pitchRef.current!, {
          pixelRatio: 2,
          backgroundColor,
        });
        const link = document.createElement('a');
        link.download = `squad-lineup-${new Date().getTime()}.png`;
        link.href = dataUrl;
        link.click();
      } catch (downloadErr) {
        console.error('[Clipboard] Fallback download also failed:', downloadErr);
      }
    } finally {
      finishExport(afterExport);
    }
  }, [pitchRef, backgroundColor, finishExport]);

  return {
    exportAsImage,
    shareAsImage,
    copyToClipboard,
    isExporting,
    canShare: canShareFiles(),
    canCopyImage: canWriteImageToClipboard(),
  };
}
