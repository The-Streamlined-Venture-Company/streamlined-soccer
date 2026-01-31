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
    if (!pitchRef.current) return null;

    flushSync(() => {
      setIsExporting(true);
      if (beforeExport) {
        beforeExport();
      }
    });

    try {
      const canvas = await html2canvas(pitchRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor,
        logging: false,
      });
      return canvas;
    } catch (err) {
      console.error('Capture failed:', err);
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
    const canvas = await captureCanvas(beforeExport, afterExport);
    if (!canvas) return;

    try {
      const link = document.createElement('a');
      link.download = `squad-lineup-${new Date().getTime()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      finishExport(afterExport);
    }
  }, [captureCanvas, finishExport]);

  // Share via Web Share API (WhatsApp, etc.)
  const shareAsImage = useCallback(async (
    beforeExport?: () => void,
    afterExport?: () => void
  ) => {
    const canvas = await captureCanvas(beforeExport, afterExport);
    if (!canvas) return;

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });

      const file = new File([blob], 'squad-lineup.png', { type: 'image/png' });
      const shareData = {
        files: [file],
        title: 'Squad Lineup',
        text: 'Check out my team lineup!',
      };

      // Check if sharing files is supported
      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else if (navigator.share) {
        // Fallback: share without file (just text)
        await navigator.share({
          title: 'Squad Lineup',
          text: 'Check out my team lineup!',
        });
      } else {
        // Final fallback: download the file
        const link = document.createElement('a');
        link.download = `squad-lineup-${new Date().getTime()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      }
    } catch (err) {
      // User cancelled sharing - not an error
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Share failed:', err);
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
    const canvas = await captureCanvas(beforeExport, afterExport);
    if (!canvas) return;

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });

      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);

      // Brief visual feedback could be added here via a callback
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      // Fallback: download instead
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
