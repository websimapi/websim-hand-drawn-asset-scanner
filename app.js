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
        setProcessedUrl(null); // Reset processed image when a new file is selected
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

        if (processingOptions.removeGridLines) {
          // === Custom Grid Line Removal, preserving color ===
          // Blur the image to reduce noise
          let blurred = new cv.Mat();
          cv.GaussianBlur(src, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

          // Convert to grayscale for edge detection
          let gray = new cv.Mat();
          cv.cvtColor(blurred, gray, cv.COLOR_RGBA2GRAY);

          // Detect edges using Canny
          let edges = new cv.Mat();
          cv.Canny(gray, edges, 50, 150, 3, false);

          // Find contours from the edges
          let contours = new cv.MatVector();
          let hierarchy = new cv.Mat();
          cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

          let candidateColors = [];
          for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true);
            // Look for convex quadrilaterals of significant area which may be grid boxes
            if (approx.rows === 4 && cv.isContourConvex(approx)) {
              let area = cv.contourArea(approx);
              if (area > (src.rows * src.cols * 0.01)) { // only consider boxes >1% of the image area
                let rect = cv.boundingRect(approx);
                let colorSamples = [];
                const samplePoints = [
                  [rect.x + rect.width / 2, rect.y],
                  [rect.x + rect.width / 2, rect.y + rect.height - 1],
                  [rect.x, rect.y + rect.height / 2],
                  [rect.x + rect.width - 1, rect.y + rect.height / 2]
                ];
                samplePoints.forEach(pt => {
                  const x = Math.min(src.cols - 1, Math.max(0, Math.floor(pt[0])));
                  const y = Math.min(src.rows - 1, Math.max(0, Math.floor(pt[1])));
                  let pixel = src.ucharPtr(y, x);
                  colorSamples.push([pixel[0], pixel[1], pixel[2]]);
                });
                let avgR = 0, avgG = 0, avgB = 0;
                colorSamples.forEach(c => {
                  avgR += c[0];
                  avgG += c[1];
                  avgB += c[2];
                });
                avgR /= colorSamples.length;
                avgG /= colorSamples.length;
                avgB /= colorSamples.length;
                candidateColors.push([avgR, avgG, avgB]);
              }
            }
            approx.delete();
            cnt.delete();
          }

          blurred.delete();
          gray.delete();
          edges.delete();
          contours.delete();
          hierarchy.delete();

          if (candidateColors.length > 0) {
            let sumR = 0, sumG = 0, sumB = 0;
            candidateColors.forEach(color => {
              sumR += color[0];
              sumG += color[1];
              sumB += color[2];
            });
            let targetR = sumR / candidateColors.length;
            let targetG = sumG / candidateColors.length;
            let targetB = sumB / candidateColors.length;

            // Create a mask for pixels matching the detected grid line color (with some tolerance)
            let mask = new cv.Mat();
            let lowerScalar = new cv.Scalar(targetR - 20, targetG - 20, targetB - 20, 0);
            let upperScalar = new cv.Scalar(targetR + 20, targetG + 20, targetB + 20, 255);
            cv.inRange(src, lowerScalar, upperScalar, mask);

            // Remove the grid lines by inpainting the masked regions
            cv.inpaint(src, mask, dst, 3, cv.INPAINT_TELEA);
            mask.delete();
          } else {
            // If no grid boxes were detected, just copy the source image
            src.copyTo(dst);
          }
        } else if (processingOptions.removeRuledLines) {
          // Existing ruled lines removal method (converts to grayscale and thresholds)
          cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
          cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
          let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
          cv.morphologyEx(dst, dst, cv.MORPH_OPEN, kernel);
          kernel.delete();
        } else {
          // No unwanted line removal – just clone the original image
          src.copyTo(dst);
        }

        // Optionally enhance contrast after processing
        if (processingOptions.enhanceContrast) {
          if (dst.channels() === 1) {
            cv.equalizeHist(dst, dst);
          } else {
            let temp = new cv.Mat();
            cv.cvtColor(dst, temp, cv.COLOR_RGBA2GRAY);
            cv.equalizeHist(temp, temp);
            cv.cvtColor(temp, dst, cv.COLOR_GRAY2RGBA);
            temp.delete();
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