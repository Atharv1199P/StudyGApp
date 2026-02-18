import { Platform } from 'react-native';

export const extractTextFromFile = async (fileOrUrl) => {
  try {
    if (!fileOrUrl) return '';

    // Fast check for PDF extension
    const isPDF = typeof fileOrUrl === 'string'
      ? fileOrUrl.toLowerCase().split('?')[0].endsWith('.pdf')
      : (fileOrUrl.name && fileOrUrl.name.toLowerCase().endsWith('.pdf'));

    if (isPDF) {
      if (Platform.OS !== 'web') {
        throw new Error('PDF files cannot be auto-read on mobile. Please open the file and copy the text manually.');
      }

      // Web only: Load PDF.js from CDN to avoid bundler issues with import.meta
      try {
        if (typeof window === 'undefined') {
          throw new Error('PDF extraction is only available in the browser.');
        }

        // Helper to load script
        const loadPdfScript = () => {
          return new Promise((resolve, reject) => {
            if (window.pdfjsLib) {
              resolve(window.pdfjsLib);
              return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.onload = () => resolve(window.pdfjsLib);
            script.onerror = () => reject(new Error('Failed to load PDF.js script'));
            document.head.appendChild(script);
          });
        };

        const pdfjs = await loadPdfScript();

        // Setup worker
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        const res = await fetch(typeof fileOrUrl === 'string' ? fileOrUrl : fileOrUrl.uri);
        if (!res.ok) throw new Error('Failed to fetch PDF data');
        const arrayBuffer = await res.arrayBuffer();

        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + '\n\n';
        }

        return fullText.trim();
      } catch (pdfErr) {
        console.warn('[FileParser] PDF extraction failed:', pdfErr);
        throw new Error('PDF files cannot be auto-read on this device (CDN load failed). Please open the file and copy the text manually.');
      }
    }

    // Check for DOCX extension
    const isDOCX = typeof fileOrUrl === 'string'
      ? fileOrUrl.toLowerCase().split('?')[0].endsWith('.docx')
      : (fileOrUrl.name && fileOrUrl.name.toLowerCase().endsWith('.docx'));

    if (isDOCX) {
      if (Platform.OS !== 'web') {
        throw new Error('DOCX files cannot be auto-read on mobile. Please open the file and copy the text manually.');
      }

      // Web only: Load Mammoth.js from CDN
      try {
        if (typeof window === 'undefined') {
          throw new Error('DOCX extraction is only available in the browser.');
        }

        const loadMammothScript = () => {
          return new Promise((resolve, reject) => {
            if (window.mammoth) {
              resolve(window.mammoth);
              return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
            script.onload = () => resolve(window.mammoth);
            script.onerror = () => reject(new Error('Failed to load Mammoth.js script'));
            document.head.appendChild(script);
          });
        };

        const mammoth = await loadMammothScript();

        const res = await fetch(typeof fileOrUrl === 'string' ? fileOrUrl : fileOrUrl.uri);
        if (!res.ok) throw new Error('Failed to fetch DOCX data');
        const arrayBuffer = await res.arrayBuffer();

        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value.trim();
      } catch (docxErr) {
        console.warn('[FileParser] DOCX extraction failed:', docxErr);
        throw new Error('DOCX files cannot be auto-read on this device (CDN load failed). Please open the file and copy the text manually.');
      }
    }

    // Standard Text File Logic
    const res = await fetch(typeof fileOrUrl === 'string' ? fileOrUrl : fileOrUrl.uri);
    if (!res.ok) throw new Error('Failed to read file');
    return await res.text();

  } catch (e) {
    if (e.message.includes('PDF')) {
      throw e; // Keep our specialized PDF message
    }
    console.error('[FileParser] Error:', e);
    return '';
  }
};
