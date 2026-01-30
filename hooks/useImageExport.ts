import { useState, useCallback, RefObject } from 'react';
import { flushSync } from 'react-dom';
import html2canvas from 'html2canvas';

interface UseImageExportOptions {
  pitchRef: RefObject<HTMLDivElement | null>;
  backgroundColor?: string;
}

interface UseImageExportReturn {
  exportAsImage: (beforeExport?: () => void, afterExport?: () => void) => Promise<void>;
  isExporting: boolean;
}

export function useImageExport({ pitchRef, backgroundColor = '#020617' }: UseImageExportOptions): UseImageExportReturn {
  const [isExporting, setIsExporting] = useState(false);

  const exportAsImage = useCallback(async (
    beforeExport?: () => void,
    afterExport?: () => void
  ) => {
    if (!pitchRef.current) return;

    // Use flushSync to ensure state changes are applied to DOM immediately
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

      const link = document.createElement('a');
      link.download = `squad-lineup-${new Date().getTime()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      throw err;
    } finally {
      flushSync(() => {
        setIsExporting(false);
        if (afterExport) {
          afterExport();
        }
      });
    }
  }, [pitchRef, backgroundColor]);

  return {
    exportAsImage,
    isExporting,
  };
}
