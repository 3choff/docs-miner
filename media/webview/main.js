const vscode = acquireVsCodeApi();
const urlInput = document.getElementById('urlInput');
const depthSlider = document.getElementById('depthSlider');
const depthValue = document.getElementById('depthValue');
const depthDescription = document.getElementById('depthDescription');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const status = document.getElementById('status');
const autoOpenFile = document.getElementById('autoOpenFile');

function updateDepthDescription(depth) {
    const descriptions = {
        1: 'Single page only',
        2: 'Page and direct links',
        3: 'Medium depth crawl',
        4: 'Deep crawl',
        5: 'Very deep crawl'
    };
    depthDescription.textContent = descriptions[depth] || '';
}

depthSlider.addEventListener('input', (e) => {
    const depth = e.target.value;
    depthValue.textContent = depth;
    updateDepthDescription(parseInt(depth));
});

startButton.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) {
        status.textContent = 'Please enter a URL';
        status.classList.add('error');
        return;
    }

    try {
        new URL(url);
    } catch {
        status.textContent = 'Please enter a valid URL';
        status.classList.add('error');
        return;
    }

    startButton.style.display = 'none';
    stopButton.style.display = 'block';
    status.classList.remove('error');
    status.textContent = 'Starting crawl...';

    vscode.postMessage({
        type: 'startCrawl',
        url: url,
        depth: parseInt(depthSlider.value)
    });
});

stopButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopCrawl' });
});

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'status':
            status.textContent = message.message;
            if (message.isError) {
                status.classList.add('error');
            } else {
                status.classList.remove('error');
            }
            if (message.message.includes('Completed!') || message.message.includes('stopped by user')) {
                startButton.style.display = 'block';
                stopButton.style.display = 'none';
            }
            break;
        case 'checkAutoOpen':
            if (autoOpenFile.checked) {
                vscode.postMessage({ 
                    type: 'openFile'
                });
            }
            break;
    }
});
