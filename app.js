const { useState, useEffect } = React;

function AssetScanner() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [processedUrl, setProcessedUrl] = useState(null);
  const [step, setStep] = useState('select'); // select, process, review, upload
  const [processingOptions, setProcessingOptions] = useState({
    removeGridLines: false,
    removeRuledLines: false,
    enhanceContrast: false
  });
  const [assets, setAssets] = useState([]);
  const [opencvReady, setOpencvReady] = useState(window.opencvReady || false);
  const room = new WebsimSocket();

  useEffect(() => {
    // Listen for the custom opencv-ready event
    const handleOpencvReady = () => {
      setOpencvReady(true);
    };

    window.addEventListener('opencv-ready', handleOpencvReady);

    // If OpenCV was already loaded before component mounted
    if (window.opencvReady) {
      setOpencvReady(true);
    }

    const unsubscribe = room.collection('asset').subscribe(assets => {
      setAssets(assets);
    });

    return () => {
      window.removeEventListener('opencv-ready', handleOpencvReady);
      unsubscribe();
    };
  }, []);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target.result);
        setProcessedUrl(null); // Reset processed image when new file selected
      };
      reader.readAsDataURL(file);
      setStep('process');
    }
  };

  const processImage = async () => {
    if (!opencvReady) {
      alert('OpenCV.js is still loading. Please wait a moment and try again.');
      return;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Create an offscreen canvas for processing
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        let src = cv.imread(canvas);
        let dst = new cv.Mat();

        if (processingOptions.removeGridLines || processingOptions.removeRuledLines) {
          cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
          cv.adaptiveThreshold(
            dst,
            dst,
            255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY,
            11,
            2
          );

          let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
          cv.morphologyEx(dst, dst, cv.MORPH_OPEN, kernel);
          kernel.delete();
        } else {
          dst = src.clone();
        }

        if (processingOptions.enhanceContrast) {
          if (dst.channels() === 1) {
            cv.equalizeHist(dst, dst);
          } else {
            cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY);
            cv.equalizeHist(dst, dst);
          }
        }

        cv.imshow(canvas, dst);
        src.delete();
        dst.delete();

        const dataUrl = canvas.toDataURL();
        setProcessedUrl(dataUrl);
        resolve();
      };
      img.onerror = (err) => {
        reject(err);
      };
      img.src = previewUrl;
    });
  };

  const handleProcess = async () => {
    try {
      await processImage();
      setStep('review');
    } catch (error) {
      console.error('Image processing failed:', error);
      alert('Failed to process image. Please try again.');
    }
  };

  const handleUpload = async () => {
    try {
      const response = await fetch(processedUrl);
      const blob = await response.blob();
      const url = await websim.upload(blob);
      
      await room.collection('asset').create({
        url,
        processingOptions,
        originalFilename: selectedFile.name
      });

      // Reset state
      setSelectedFile(null);
      setPreviewUrl(null);
      setProcessedUrl(null);
      setStep('select');
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload asset. Please try again.');
    }
  };

  return (
    <div className="scanner-container">
      <h1>Hand-Drawn Asset Scanner</h1>
      
      {!opencvReady && (
        <div className="loading-message">
          Loading OpenCV.js... Please wait.
        </div>
      )}
      
      <div className="step-indicator">
        <div className={`step ${step === 'select' ? 'active' : ''}`}>1. Select</div>
        <div className={`step ${step === 'process' ? 'active' : ''}`}>2. Process</div>
        <div className={`step ${step === 'review' ? 'active' : ''}`}>3. Review</div>
      </div>

      {step === 'select' && (
        <div className="controls">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            capture="environment"
          />
        </div>
      )}

      {step === 'process' && (
        <div className="process-step">
          <div className="preview-container">
            <h3>Original Image:</h3>
            <img src={previewUrl} alt="Preview" />
          </div>

          <div className="processing-options">
            <h3>Processing Options:</h3>
            <div className="processing-option">
              <label>
                <input
                  type="checkbox"
                  checked={processingOptions.removeGridLines}
                  onChange={(e) =>
                    setProcessingOptions((prev) => ({
                      ...prev,
                      removeGridLines: e.target.checked
                    }))
                  }
                />
                Remove Grid Lines
              </label>
            </div>

            <div className="processing-option">
              <label>
                <input
                  type="checkbox"
                  checked={processingOptions.removeRuledLines}
                  onChange={(e) =>
                    setProcessingOptions((prev) => ({
                      ...prev,
                      removeRuledLines: e.target.checked
                    }))
                  }
                />
                Remove Ruled Lines
              </label>
            </div>

            <div className="processing-option">
              <label>
                <input
                  type="checkbox"
                  checked={processingOptions.enhanceContrast}
                  onChange={(e) =>
                    setProcessingOptions((prev) => ({
                      ...prev,
                      enhanceContrast: e.target.checked
                    }))
                  }
                />
                Enhance Contrast
              </label>
            </div>
          </div>

          <div className="controls">
            <button onClick={handleProcess}>Process Image</button>
            <button
              onClick={() => {
                setStep('select');
                setSelectedFile(null);
                setPreviewUrl(null);
              }}
              className="secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="review-step">
          <div className="image-comparison">
            <div className="preview-container">
              <h3>Original:</h3>
              <img src={previewUrl} alt="Original" />
            </div>
            <div className="preview-container">
              <h3>Processed:</h3>
              {processedUrl && <img src={processedUrl} alt="Processed" />}
            </div>
          </div>

          <div className="controls">
            <button onClick={handleUpload}>Upload Processed Image</button>
            <button
              onClick={() => setStep('process')}
              className="secondary"
            >
              Adjust Processing
            </button>
            <button
              onClick={() => {
                setStep('select');
                setSelectedFile(null);
                setPreviewUrl(null);
                setProcessedUrl(null);
              }}
              className="secondary"
            >
              Start Over
            </button>
          </div>
        </div>
      )}

      <div className="gallery">
        <h2>Uploaded Assets</h2>
        {assets.map((asset) => (
          <div key={asset.id} className="gallery-item">
            <img src={asset.url} alt={asset.originalFilename} />
            <div className="gallery-info">
              <div>By: {asset.username}</div>
              <div>File: {asset.originalFilename}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

ReactDOM.render(<AssetScanner />, document.getElementById('root'));