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
    crawlerMethod: document.getElementById('crawlerMethod'),
    outputFileName: document.getElementById('outputFileName'),
    selectFileButton: document.getElementById('selectFileButton'),
    branchSelect: document.getElementById('branchSelect'),
    branchSelection: document.getElementById('branchSelection'),
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

function isGithubUrl(url) {
    try {
        const urlObj = new URL(url);
        const isGithub = urlObj.hostname === 'github.com';
        return isGithub;
    } catch {
        return false;
    }
}

function updateMethodDropdown(url) {
    const isGithub = isGithubUrl(url);
    ELEMENTS.crawlerMethod.disabled = isGithub;
    ELEMENTS.crawlerMethod.closest('.crawler-method').classList.toggle('github-mode', isGithub);
}

function updateMethodVisibility(url) {
    const isGithub = isGithubUrl(url);
    const githubControls = document.getElementById('githubControls');
    const websiteControls = document.getElementById('websiteControls');
    
    githubControls.style.display = isGithub ? 'block' : 'none';
    websiteControls.style.display = isGithub ? 'none' : 'block';
}

ELEMENTS.depthSlider.addEventListener('input', (e) => {
    const depth = parseInt(e.target.value);
    ELEMENTS.depthValue.textContent = depth;
    ELEMENTS.depthDescription.textContent = DEPTH_DESCRIPTIONS[depth] || '';
});

ELEMENTS.urlInput.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    
    if (url) {
        updateMethodVisibility(url);
        // Clear existing branches when URL changes
        ELEMENTS.branchSelect.innerHTML = '';
        ELEMENTS.branchSelection.style.display = 'none';
        
        if (isGithubUrl(url)) {
            vscode.postMessage({
                type: 'getGithubBranches',
                url: url
            });
        }
    } else {
        // Show website controls by default when input is empty
        updateMethodVisibility('');
    }
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
        outputFileName: ELEMENTS.outputFileName.value.trim(),
        method: ELEMENTS.crawlerMethod.value,
        branch: ELEMENTS.branchSelect.value
    });
});

ELEMENTS.stopButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopCrawl' });
});

ELEMENTS.selectFileButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'selectFile' });
});

window.addEventListener('message', event => {
    const { type, message, isError, filePath, branches, defaultBranch } = event.data;
    
    switch (type) {
        case 'status':
            updateStatus(message, isError);
            if (isError || message.includes('Completed!') || message.includes('stopped by user')) {
                toggleCrawlButtons(false);
            }
            break;
        case 'checkAutoOpen':
            if (ELEMENTS.autoOpenFile.checked) {
                vscode.postMessage({ type: 'openFile' });
            }
            break;
        case 'fileSelected':
            if (filePath) {
                const workspacePath = event.data.workspacePath;
                
                // Get filename without extension
                const fullFileName = filePath.split(/[/\\]/).pop() || '';
                const fileName = fullFileName.replace(/\.md$/, '');

                // Get relative path by removing filename from filepath
                const relativePath = filePath.slice(0, -fullFileName.length);

                // Get folder path by removing workspace path from relative path
                const folderPath = relativePath.replace(workspacePath, '').replace(/^[/\\]/, '').replace(/[/\\]$/, '');
                
                ELEMENTS.outputFileName.value = fileName;
                ELEMENTS.outputFolder.value = folderPath;
            }
            break;
        case 'populateBranches':
            populateBranchSelect(branches, defaultBranch);
            break;
    }
});

function populateBranchSelect(branches, defaultBranch, branchSpecifiedInUrl = false) {
    
    // Clear existing options
    ELEMENTS.branchSelect.innerHTML = '';
    
    // Add branches to select
    branches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.text = branch + (branch === defaultBranch ? ' (default)' : '');
        option.selected = branch === defaultBranch;
        ELEMENTS.branchSelect.appendChild(option);
    });
    
    // Only show selector if multiple branches exist and branch not specified in URL
    const shouldShow = !branchSpecifiedInUrl && branches.length > 1;
    ELEMENTS.branchSelection.style.display = shouldShow ? 'block' : 'none';
}