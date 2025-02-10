const { useState, useEffect, useRef } = React;

function AssetScanner() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [processingOptions, setProcessingOptions] = useState({
    removeGridLines: false,
    removeRuledLines: false,
    enhanceContrast: false
  });
  const [assets, setAssets] = useState([]);
  const canvasRef = useRef(null);
  const room = new WebsimSocket();

  useEffect(() => {
    // Subscribe to asset collection updates
    return room.collection('asset').subscribe(assets => {
      setAssets(assets);
    });
  }, []);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => setPreviewUrl(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const processImage = async () => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        let src = cv.imread(canvas);
        let dst = new cv.Mat();

        if (processingOptions.removeGridLines || processingOptions.removeRuledLines) {
          // Convert to grayscale
          cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
          
          // Apply adaptive threshold
          cv.adaptiveThreshold(dst, dst, 255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY, 11, 2);

          // Morphological operations to remove lines
          let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
          cv.morphologyEx(dst, dst, cv.MORPH_OPEN, kernel);
          kernel.delete();
        }

        if (processingOptions.enhanceContrast) {
          cv.equalizeHist(dst, dst);
        }

        cv.imshow(canvas, dst);
        
        src.delete();
        dst.delete();

        canvas.toBlob(resolve);
      };
      img.src = previewUrl;
    });
  };

  const handleUpload = async () => {
    try {
      const processedBlob = await processImage();
      const url = await websim.upload(processedBlob);
      
      await room.collection('asset').create({
        url,
        processingOptions,
        originalFilename: selectedFile.name
      });

      setSelectedFile(null);
      setPreviewUrl(null);
      setShowConfirmation(false);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload asset. Please try again.');
    }
  };

  return (
    <div className="scanner-container">
      <h1>Hand-Drawn Asset Scanner</h1>
      
      <div className="controls">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          capture="environment"
        />
        {selectedFile && (
          <button 
            onClick={() => setShowConfirmation(true)}
          >
            Process & Upload
          </button>
        )}
      </div>

      {previewUrl && (
        <div className="preview-container">
          <canvas ref={canvasRef} />
        </div>
      )}

      {showConfirmation && (
        <div className="modal">
          <div className="modal-content">
            <h2>Configure Processing</h2>
            
            <div className="processing-options">
              <div className="processing-option">
                <label>
                  <input
                    type="checkbox"
                    checked={processingOptions.removeGridLines}
                    onChange={(e) => setProcessingOptions(prev => ({
                      ...prev,
                      removeGridLines: e.target.checked
                    }))}
                  />
                  Remove Grid Lines
                </label>
              </div>

              <div className="processing-option">
                <label>
                  <input
                    type="checkbox"
                    checked={processingOptions.removeRuledLines}
                    onChange={(e) => setProcessingOptions(prev => ({
                      ...prev,
                      removeRuledLines: e.target.checked
                    }))}
                  />
                  Remove Ruled Lines
                </label>
              </div>

              <div className="processing-option">
                <label>
                  <input
                    type="checkbox"
                    checked={processingOptions.enhanceContrast}
                    onChange={(e) => setProcessingOptions(prev => ({
                      ...prev,
                      enhanceContrast: e.target.checked
                    }))}
                  />
                  Enhance Contrast
                </label>
              </div>
            </div>

            <div className="controls">
              <button onClick={handleUpload}>Confirm Upload</button>
              <button 
                onClick={() => setShowConfirmation(false)}
                style={{ background: '#f44336' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="gallery">
        {assets.map(asset => (
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