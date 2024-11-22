const vscode = acquireVsCodeApi();
const ELEMENTS = {
    urlInput: document.getElementById('urlInput'),
    depthSlider: document.getElementById('depthSlider'),
    depthValue: document.getElementById('depthValue'),
    depthDescription: document.getElementById('depthDescription'),
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    status: document.getElementById('status'),
    autoOpenFile: document.getElementById('autoOpenFile'),
    outputFolder: document.getElementById('outputFolder'),
    crawlerMethod: document.getElementById('crawlerMethod')
};

const DEPTH_DESCRIPTIONS = {
    1: 'Only the entered page',
    2: 'The entered page and links at the same directory level',
    3: 'The entered page and links up to two directory levels',
    4: 'The entered page and links up to three directory levels',
    5: 'The entered page and links up to four directory levels'
};

function updateStatus(message, isError = false) {
    ELEMENTS.status.textContent = message;
    ELEMENTS.status.classList.toggle('error', isError);
}

function toggleCrawlButtons(isCrawling) {
    ELEMENTS.startButton.style.display = isCrawling ? 'none' : 'block';
    ELEMENTS.stopButton.style.display = isCrawling ? 'block' : 'none';
}

function validateUrl(url) {
    if (!url) {
        updateStatus('Please enter a URL', true);
        return false;
    }
    try {
        new URL(url);
        return true;
    } catch {
        updateStatus('Please enter a valid URL', true);
        return false;
    }
}

ELEMENTS.depthSlider.addEventListener('input', (e) => {
    const depth = parseInt(e.target.value);
    ELEMENTS.depthValue.textContent = depth;
    ELEMENTS.depthDescription.textContent = DEPTH_DESCRIPTIONS[depth] || '';
});

ELEMENTS.startButton.addEventListener('click', () => {
    const url = ELEMENTS.urlInput.value.trim();
    if (!validateUrl(url)) return;

    toggleCrawlButtons(true);
    updateStatus('Starting crawl...');

    vscode.postMessage({
        type: 'startCrawl',
        url,
        depth: parseInt(ELEMENTS.depthSlider.value),
        outputFolder: ELEMENTS.outputFolder.value.trim(),
        method: ELEMENTS.crawlerMethod.value
    });
});

ELEMENTS.stopButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopCrawl' });
});

window.addEventListener('message', event => {
    const { type, message, isError } = event.data;
    
    switch (type) {
        case 'status':
            updateStatus(message, isError);
            if (message.includes('Completed!') || message.includes('stopped by user')) {
                toggleCrawlButtons(false);
            }
            break;
        case 'checkAutoOpen':
            if (ELEMENTS.autoOpenFile.checked) {
                vscode.postMessage({ type: 'openFile' });
            }
            break;
    }
});