const vscode = acquireVsCodeApi();
const urlInput = document.getElementById('urlInput');
const depthSlider = document.getElementById('depthSlider');
const depthValue = document.getElementById('depthValue');
const depthDescription = document.getElementById('depthDescription');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const status = document.getElementById('status');
const autoOpenFile = document.getElementById('autoOpenFile');
const outputFolder = document.getElementById('outputFolder');
const crawlerMethod = document.getElementById('crawlerMethod');

function updateDepthDescription(depth) {
    const descriptions = {
        1: 'Current page only',
        2: 'Current page + one level down',
        3: 'Current page + two levels down',
        4: 'Current page + three levels down',
        5: 'Current page + four levels down'
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
        depth: parseInt(depthSlider.value),
        outputFolder: outputFolder.value.trim(),
        method: crawlerMethod.value
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
