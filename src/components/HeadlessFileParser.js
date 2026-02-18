import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

const PARSER_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>
</head>
<body>
  <script>
    // Setup PDF.js
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    async function parseFile(data) {
      try {
        const { type, uri, name } = data;
        let arrayBuffer;

        // Fetch the file data
        const response = await fetch(uri);
        if (!response.ok) throw new Error('Failed to fetch file');
        arrayBuffer = await response.arrayBuffer();

        let text = '';

        if (type === 'pdf' || (name && name.toLowerCase().endsWith('.pdf'))) {
          // Parse PDF
          if (!window.pdfjsLib) throw new Error('PDF.js not loaded');
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            text += pageText + '\\n\\n';
          }
        } else if (type === 'docx' || (name && name.toLowerCase().endsWith('.docx'))) {
          // Parse DOCX
          if (!window.mammoth) throw new Error('Mammoth.js not loaded');
          const result = await mammoth.extractRawText({ arrayBuffer });
          text = result.value;
        } else {
          // Plain Text
          const decoder = new TextDecoder('utf-8');
          text = decoder.decode(arrayBuffer);
        }

        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'success', text: text.trim() }));
      } catch (e) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message || 'Unknown parsing error' }));
      }
    }

    // Listen for messages from RN
    // On Android, we might need document event listener, but usually this global function override works for 'injectJavaScript'
    // or standard message event listener?
    // Actually, best way is to expose a global function and call it via injectJavaScript
    window.handleParseRequest = function(jsonData) {
      const data = JSON.parse(jsonData);
      parseFile(data);
    };
  </script>
</body>
</html>
`;

export const HeadlessFileParser = forwardRef((props, ref) => {
    const webViewRef = useRef(null);
    const [pendingResolvers, setPendingResolvers] = useState([]);

    useImperativeHandle(ref, () => ({
        parseFile: (fileUrl, fileName) => {
            return new Promise((resolve, reject) => {
                if (!webViewRef.current) {
                    reject(new Error('WebView not ready'));
                    return;
                }

                // We only support one pending request at a time properly in this simple implementation,
                // (or we could map IDs), but simplistic FIFO queue is okay for now
                // Actually, let's just use a one-off since user clicks one file at a time
                global.parserResolve = resolve;
                global.parserReject = reject;

                const isPdf = fileName?.toLowerCase().endsWith('.pdf');
                const isDocx = fileName?.toLowerCase().endsWith('.docx');
                const type = isPdf ? 'pdf' : isDocx ? 'docx' : 'text';

                const payload = JSON.stringify({ uri: fileUrl, type, name: fileName });
                webViewRef.current.injectJavaScript(`window.handleParseRequest('${payload}'); true;`);
            });
        }
    }));

    const onMessage = (event) => {
        try {
            const data = JSON.parse(event.nativeEvent.data);
            if (global.parserResolve && global.parserReject) {
                if (data.type === 'success') {
                    global.parserResolve(data.text);
                } else {
                    global.parserReject(new Error(data.message));
                }
                // creating new refs or managing state to clear global callbacks
                global.parserResolve = null;
                global.parserReject = null;
            }
        } catch (e) {
            console.error('Parser message error:', e);
        }
    };

    return (
        <View style={{ height: 0, width: 0, position: 'absolute', opacity: 0 }}>
            <WebView
                ref={webViewRef}
                originWhitelist={['*']}
                source={{ html: PARSER_HTML }}
                onMessage={onMessage}
                javaScriptEnabled={true}
                allowFileAccess={true}
                allowUniversalAccessFromFileURLs={true}
            />
        </View>
    );
});
