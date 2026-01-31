import { useState, useCallback, RefObject } from 'react';
import { flushSync } from 'react-dom';
import html2canvas from 'html2canvas';

interface UseImageExportOptions {
  pitchRef: RefObject<HTMLDivElement | null>;
  backgroundColor?: string;
}

type ExportAction = 'download' | 'share' | 'clipboard';

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
  // Check if file sharing is supported (not all browsers support it)
  return typeof navigator.canShare === 'function';
};

// Check if clipboard API supports writing images
const canWriteImageToClipboard = (): boolean => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  return typeof ClipboardItem !== 'undefined';
};

export function useImageExport({ pitchRef, backgroundColor = '#020617' }: UseImageExportOptions): UseImageExportReturn {
  const [isExporting, setIsExporting] = useState(false);

  const captureCanvas = useCallback(async (
    beforeExport?: () => void,
    afterExport?: () => void
  ): Promise<HTMLCanvasElement | null> => {
    console.log('[Export] captureCanvas called, pitchRef:', pitchRef.current);
    if (!pitchRef.current) {
      console.error('[Export] pitchRef.current is null!');
      return null;
    }

    flushSync(() => {
      setIsExporting(true);
      if (beforeExport) {
        beforeExport();
      }
    });

    try {
      console.log('[Export] Starting html2canvas...');
      const canvas = await html2canvas(pitchRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor,
        logging: true,
      });
      console.log('[Export] html2canvas completed, canvas:', canvas.width, 'x', canvas.height);
      return canvas;
    } catch (err) {
      console.error('[Export] Capture failed:', err);
      flushSync(() => {
        setIsExporting(false);
        if (afterExport) {
          afterExport();
        }
      });
      return null;
    }
  }, [pitchRef, backgroundColor]);

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
    const canvas = await captureCanvas(beforeExport, afterExport);
    if (!canvas) {
      console.error('[Export] No canvas returned from captureCanvas');
      return;
    }

    try {
      console.log('[Export] Creating download link...');
      const link = document.createElement('a');
      link.download = `squad-lineup-${new Date().getTime()}.png`;
      link.href = canvas.toDataURL('image/png');
      console.log('[Export] Triggering download...');
      link.click();
      console.log('[Export] Download triggered');
    } catch (err) {
      console.error('[Export] Export failed:', err);
    } finally {
      finishExport(afterExport);
    }
  }, [captureCanvas, finishExport]);

  // Share via Web Share API (WhatsApp, etc.)
  const shareAsImage = useCallback(async (
    beforeExport?: () => void,
    afterExport?: () => void
  ) => {
    console.log('[Share] shareAsImage called');
    const canvas = await captureCanvas(beforeExport, afterExport);
    if (!canvas) {
      console.error('[Share] No canvas returned from captureCanvas');
      return;
    }

    try {
      console.log('[Share] Creating blob...');
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });
      console.log('[Share] Blob created, size:', blob.size);

      const file = new File([blob], 'squad-lineup.png', { type: 'image/png' });
      const shareData = {
        files: [file],
        title: 'Squad Lineup',
        text: 'Check out my team lineup!',
      };

      console.log('[Share] navigator.share:', !!navigator.share);
      console.log('[Share] navigator.canShare:', !!navigator.canShare);

      // Check if sharing files is supported
      if (navigator.canShare && navigator.canShare(shareData)) {
        console.log('[Share] Sharing with files...');
        await navigator.share(shareData);
        console.log('[Share] Share completed');
      } else if (navigator.share) {
        // Fallback: share without file (just text)
        console.log('[Share] Sharing without files (text only)...');
        await navigator.share({
          title: 'Squad Lineup',
          text: 'Check out my team lineup!',
        });
      } else {
        // Final fallback: download the file
        console.log('[Share] No share API, falling back to download...');
        const link = document.createElement('a');
        link.download = `squad-lineup-${new Date().getTime()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      }
    } catch (err) {
      // User cancelled sharing - not an error
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('[Share] Share failed:', err);
      } else {
        console.log('[Share] User cancelled');
      }
    } finally {
      finishExport(afterExport);
    }
  }, [captureCanvas, finishExport]);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (
    beforeExport?: () => void,
    afterExport?: () => void
  ) => {
    console.log('[Clipboard] copyToClipboard called');
    const canvas = await captureCanvas(beforeExport, afterExport);
    if (!canvas) {
      console.error('[Clipboard] No canvas returned from captureCanvas');
      return;
    }

    try {
      console.log('[Clipboard] Creating blob...');
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });
      console.log('[Clipboard] Blob created, size:', blob.size);

      console.log('[Clipboard] ClipboardItem available:', typeof ClipboardItem !== 'undefined');
      console.log('[Clipboard] navigator.clipboard.write available:', !!navigator.clipboard?.write);

      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      console.log('[Clipboard] Copy successful!');

    } catch (err) {
      console.error('[Clipboard] Copy to clipboard failed:', err);
      // Fallback: download instead
      console.log('[Clipboard] Falling back to download...');
      const link = document.createElement('a');
      link.download = `squad-lineup-${new Date().getTime()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      finishExport(afterExport);
    }
  }, [captureCanvas, finishExport]);

  return {
    exportAsImage,
    shareAsImage,
    copyToClipboard,
    isExporting,
    canShare: canShareFiles(),
    canCopyImage: canWriteImageToClipboard(),
  };
}
