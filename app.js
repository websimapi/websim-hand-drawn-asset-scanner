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
          // Updated Grid Line Removal Algorithm:
          // 1. Blur the image to reduce noise
          let blurred = new cv.Mat();
          cv.GaussianBlur(src, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

          // 2. Convert to grayscale and perform edge detection
          let gray = new cv.Mat();
          cv.cvtColor(blurred, gray, cv.COLOR_RGBA2GRAY);
          let edges = new cv.Mat();
          cv.Canny(gray, edges, 50, 150, 3, false);

          // 3. Find contours and detect square shapes (grid squares)
          let contours = new cv.MatVector();
          let hierarchy = new cv.Mat();
          cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

          let candidateColors = [];
          for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            let approx = new cv.Mat();
            let peri = cv.arcLength(cnt, true);
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

            // Check if the approximated contour is a convex quadrilateral
            if (approx.rows === 4 && cv.isContourConvex(approx)) {
              let rect = cv.boundingRect(approx);
              // Ensure the shape is roughly square via aspect ratio check
              let aspectRatio = rect.width / rect.height;
              if (aspectRatio > 0.8 && aspectRatio < 1.2) {
                let area = cv.contourArea(approx);
                // Consider only sufficiently large squares
                if (area > (src.rows * src.cols * 0.005)) {
                  // Sample the grid line color by taking midpoints of each edge
                  let samplePoints = [
                    { x: rect.x + rect.width / 2, y: rect.y }, // top edge
                    { x: rect.x + rect.width, y: rect.y + rect.height / 2 }, // right edge
                    { x: rect.x + rect.width / 2, y: rect.y + rect.height }, // bottom edge
                    { x: rect.x, y: rect.y + rect.height / 2 } // left edge
                  ];
                  let colorSamples = [];
                  samplePoints.forEach(pt => {
                    let x = Math.floor(Math.min(src.cols - 1, Math.max(0, pt.x)));
                    let y = Math.floor(Math.min(src.rows - 1, Math.max(0, pt.y)));
                    let pixel = src.ucharPtr(y, x);
                    colorSamples.push([pixel[0], pixel[1], pixel[2]]);
                  });
                  let sumR = 0, sumG = 0, sumB = 0;
                  colorSamples.forEach(c => {
                    sumR += c[0];
                    sumG += c[1];
                    sumB += c[2];
                  });
                  let avgR = sumR / colorSamples.length;
                  let avgG = sumG / colorSamples.length;
                  let avgB = sumB / colorSamples.length;
                  candidateColors.push([avgR, avgG, avgB]);
                }
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
            // Average the candidate colors to determine the dominant grid line color
            let sumR = 0, sumG = 0, sumB = 0;
            candidateColors.forEach(color => {
              sumR += color[0];
              sumG += color[1];
              sumB += color[2];
            });
            let targetR = sumR / candidateColors.length;
            let targetG = sumG / candidateColors.length;
            let targetB = sumB / candidateColors.length;

            // Create a mask for pixels matching the grid line color (with tolerance)
            let mask = new cv.Mat();
            let lowerScalar = new cv.Scalar(targetR - 20, targetG - 20, targetB - 20, 0);
            let upperScalar = new cv.Scalar(targetR + 20, targetG + 20, targetB + 20, 255);
            cv.inRange(src, lowerScalar, upperScalar, mask);

            // Remove grid lines by inpainting the masked regions
            cv.inpaint(src, mask, dst, 3, cv.INPAINT_TELEA);
            mask.delete();
          } else {
            // If no grid squares are detected, just copy the source image
            src.copyTo(dst);
          }
        } else if (processingOptions.removeRuledLines) {
          // Existing ruled lines removal method (grayscale conversion and adaptive threshold)
          cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
          cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
          let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
          cv.morphologyEx(dst, dst, cv.MORPH_OPEN, kernel);
          kernel.delete();
        } else {
          // No line removal selected – just clone the original image
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