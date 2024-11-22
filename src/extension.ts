import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import PCR from 'puppeteer-chromium-resolver';
import TurndownService from 'turndown';

class DocsMinerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'docsMinerView';
    private _view?: vscode.WebviewView;
    private _stopCrawling: boolean = false;
    private _outputFile?: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'startCrawl':
                    this._stopCrawling = false;
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders) {
                        vscode.window.showErrorMessage('Please open a workspace first');
                        return;
                    }
                    const workspaceFolder = workspaceFolders[0].uri.fsPath;
                    const urlParts = new URL(data.url);
                    
                    // Create output folder path if specified
                    let outputPath = workspaceFolder;
                    if (data.outputFolder) {
                        outputPath = path.join(workspaceFolder, data.outputFolder);
                        // Create the folder if it doesn't exist
                        if (!fs.existsSync(outputPath)) {
                            await fs.promises.mkdir(outputPath, { recursive: true });
                        }
                    }
                    
                    // Create a filename from the full URL
                    let urlPath = urlParts.pathname.replace(/\//g, '-');
                    urlPath = urlPath.replace(/^-|-$/g, ''); // Remove leading/trailing dashes
                    if (urlPath === '') urlPath = 'home';
                    
                    // Add query parameters if they exist
                    const queryString = urlParts.search.replace(/[?&]/g, '-').replace(/[=]/g, '-');
                    const sanitizedQuery = queryString ? `-${queryString.replace(/^-|-$/g, '')}` : '';
                    
                    // Combine parts and sanitize
                    const fileName = `${urlParts.hostname}${urlPath}${sanitizedQuery}-docs.md`
                        .toLowerCase()
                        .replace(/[^a-z0-9\-\.]/g, '-') // Replace invalid chars with dash
                        .replace(/-+/g, '-') // Replace multiple dashes with single dash
                        .substring(0, 255); // Limit filename length
                    
                    this._outputFile = path.join(outputPath, fileName);
                    
                    try {
                        await this.crawlAndScrape(data.url, data.depth, webviewView.webview, data.method);
                    } catch (error) {
                        vscode.window.showErrorMessage(`Error during crawling: ${error}`);
                    }
                    break;
                case 'stopCrawl':
                    this._stopCrawling = true;
                    webviewView.webview.postMessage({
                        type: 'status',
                        message: 'Stopping crawl... \nPlease wait for current page to finish.'
                    });
                    break;
                case 'openFile':
                    if (this._outputFile) {
                        const doc = await vscode.workspace.openTextDocument(this._outputFile);
                        await vscode.window.showTextDocument(doc);
                    }
                    break;
            }
        });
    }

    private async saveToFile(content: string, append: boolean = false) {
        if (!this._outputFile) return;
        
        try {
            if (append) {
                await fs.promises.appendFile(this._outputFile, content);
            } else {
                await fs.promises.writeFile(this._outputFile, content);
            }
        } catch (error) {
            console.error('Error saving to file:', error);
            throw error;
        }
    }

    private async getContentWithPuppeteer(url: string): Promise<string> {
        const stats = await PCR();
        const browser = await stats.puppeteer.launch({
            headless: 'new',
            executablePath: stats.executablePath
        });
        
        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Get the page title early
            const pageTitle = await page.title();
            
            // Process the page content
            await page.evaluate((baseUrl) => {
                // Helper function to check if an element is part of documentation
                const isDocumentationBlock = (element: Element): boolean => {
                    const docContainers = [
                        '.documentation', '.docs-content', '.markdown-body', 
                        'article', 'main', '.content', '.doc-content',
                        '[role="main"]', '.documentation-content'
                    ];
                    return docContainers.some(selector => 
                        element.closest(selector) !== null
                    );
                };

                // Convert all relative URLs to absolute
                const links = document.querySelectorAll('a[href]');
                links.forEach((el) => {
                    const href = el.getAttribute('href');
                    if (href) {
                        if (href.startsWith('/')) {
                            el.setAttribute('href', new URL(href, baseUrl).href);
                        } else if (!href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('#')) {
                            el.setAttribute('href', new URL(href, baseUrl).href);
                        }
                    }
                });

                // Handle scripts based on context
                const scripts = document.getElementsByTagName('script');
                Array.from(scripts).forEach(script => {
                    const isUtilityScript = (
                        script.textContent?.includes('!function') ||
                        script.textContent?.includes('window.__CF') ||
                        script.textContent?.includes('intercom') ||
                        script.textContent?.includes('analytics') ||
                        script.textContent?.includes('gtag') ||
                        script.textContent?.includes('tracking') ||
                        script.getAttribute('src')?.includes('analytics') ||
                        script.getAttribute('src')?.includes('tracking')
                    );

                    // Remove if it's a utility script or not in documentation block
                    if (isUtilityScript || !isDocumentationBlock(script)) {
                        script.parentNode?.removeChild(script);
                    }
                });

                // Remove non-documentation UI elements
                const uiElements = document.querySelectorAll(
                    'style, ' +
                    '[class*="intercom-"], [class*="animation-"], ' +
                    '[id*="tracking"], [id*="analytics"], ' +
                    '[class*="cookie"], [class*="popup"], ' +
                    'nav:not(.doc-nav), footer:not(.doc-footer)'
                );
                uiElements.forEach(el => {
                    if (!isDocumentationBlock(el)) {
                        el.parentNode?.removeChild(el);
                    }
                });
            }, url);
            
            const content = await page.content();
            
            // Convert HTML to Markdown
            const turndownService = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced'
            });
            
            // Additional Turndown rules for code blocks
            turndownService.addRule('preserveDocumentationCode', {
                filter: (node: HTMLElement): boolean => {
                    const isCodeBlock = node.nodeName === 'PRE' || 
                                      node.nodeName === 'CODE' ||
                                      node.classList.contains('highlight') ||
                                      node.classList.contains('code-example');
                    
                    const isUtilityScript = node.textContent?.includes('!function') ||
                                          node.textContent?.includes('window.__CF') ||
                                          node.textContent?.includes('intercom') ||
                                          node.textContent?.includes('analytics') ||
                                          node.textContent?.includes('gtag') ||
                                          node.textContent?.includes('tracking');
                    
                    return isCodeBlock && !isUtilityScript;
                },

                replacement: function(content: string, node): string {         
                    // Preserve indentation and don't replace backticks
                    const cleanContent = content
                        .trim()
                        // Remove CSS-like content
                        .replace(/\[data-.*?\}+/gs, '')
                        // remove leading and trailing whitespace                    
                        // .replace(/^\s+|\s+$/gm, '')
                        // remove line numbers
                        .replace(/^\d+\s*$/gm, '')
                        .replace(/```/g, '');

                    const result = `\n\`\`\`${cleanContent ? '\n' + cleanContent : ''}\n\`\`\`\n`;
                    return result;
                }
            
            });
            
            const markdown = turndownService.turndown(content);
            
            // Format the content with metadata to match API output
            const formattedContent = [
                `## Title: ${pageTitle}`,
                // `URL Source: ${url}`,
                // 'Markdown Content:',
                markdown
                    .replace(/@keyframes[\s\S]*?}/g, '')      // Remove @keyframes blocks
                    .replace(/\.intercom[\s\S]*?}/g, '')      // Remove intercom-specific CSS
                    .replace(/\.tracking[\s\S]*?}/g, '')      // Remove tracking-related CSS
                    .replace(/\n{3,}/g, '\n\n')               // Remove excessive newlines
                    .trim()
            ].join('\n\n');
            
            return formattedContent;
            
        } finally {
            await browser.close();
        }
    }

    private async getPageContent(url: string, method: string): Promise<string> {
        if (method === 'api') {
            try {
                const markdownResponse = await axios.get(`https://r.jina.ai/${url}`, {
                    timeout: 30000,
                    headers: {
                        'Accept': 'text/markdown'
                    }
                });
                return markdownResponse.data;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                throw new Error(`API method failed: ${errorMessage}`);
            }
        } else {
            try {
                return await this.getContentWithPuppeteer(url);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                throw new Error(`Browser method failed: ${errorMessage}`);
            }
        }
    }

    private parseGitHubUrl(url: string) {
        const urlParts = new URL(url);
        const pathParts = urlParts.pathname.split('/').filter(Boolean);
        return {
            owner: pathParts[0],
            repo: pathParts[1],
            type: pathParts[2], // 'tree' or 'blob'
            branch: pathParts[3] || 'main',
            basePath: pathParts.slice(4).join('/'),
            isSpecificPath: pathParts.length > 4
        };
    }

    private async getRepoContents(owner: string, repo: string, branch: string) {
        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const response = await axios.get(treeUrl);
        return response.data.tree;
    }

    private async crawlAndScrape(startUrl: string, depth: number, webview: vscode.Webview, method: string): Promise<void> {
        const startTime = new Date();
        
        // Clear file at start for both branches
        if (this._outputFile) {
            await this.saveToFile('', false);
        }

        if (startUrl.includes('github.com')) {
            try {

                const githubInfo = this.parseGitHubUrl(startUrl);

                if (!this._outputFile) {
                    throw new Error('Output file path not set');
                }

                webview.postMessage({
                    type: 'status',
                    message: `Starting GitHub repository crawl: \n${githubInfo.owner}/${githubInfo.repo}`
                });

                const files = await this.getRepoContents(
                    githubInfo.owner, 
                    githubInfo.repo, 
                    githubInfo.branch
                );

                // Filter files based on depth and base path
                const filteredFiles = files.filter((file: any) => {
                    if (file.type !== 'blob') return false;
                    
                    // Check if file is within specified directory
                    if (githubInfo.isSpecificPath && !file.path.startsWith(githubInfo.basePath)) {
                        return false;
                    }

                    // Calculate relative depth
                    const relativePath = githubInfo.isSpecificPath 
                        ? file.path.slice(githubInfo.basePath.length).replace(/^\//, '')
                        : file.path;
                    const fileDepth = relativePath.split('/').filter(Boolean).length;
                    
                    return fileDepth <= depth;
                });

                let content = '';
                let currentFile = 0;
                const totalFiles = filteredFiles.length;

                // Add initial count message
                webview.postMessage({
                    type: 'status',
                    message: `Found ${totalFiles} files to process within depth ${depth}`
                });

                for (const file of filteredFiles) {
                    if (this._stopCrawling) {
                        webview.postMessage({
                            type: 'status',
                            message: 'Crawling stopped by user.'
                        });
                        break;
                    }

                    currentFile++;

                    webview.postMessage({
                        type: 'status',
                        message: `[${currentFile}/${totalFiles}] ${file.path}\nDepth: ${file.path.split('/').length}/${depth}`
                    });

                    try {
                        // let fileContent;
                        // Create raw URL for both methods
                        const rawUrl = `https://raw.githubusercontent.com/${githubInfo.owner}/${githubInfo.repo}/${githubInfo.branch}/${file.path}`;
                        
                        // if (method === 'api') {
                        //     // API method
                        //     const response = await axios.get(rawUrl);
                        //     fileContent = response.data;
                        //     // Keep delay only for API method to prevent rate limiting
                        //     await new Promise(resolve => setTimeout(resolve, 500));
                        // } else {
                            // Browser method - now using the same raw URL
                            // fileContent = await this.getContentWithPuppeteer(rawUrl);
                        const response = await axios.get(rawUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                            }
                        });
                        const fileContent = response.data;
                        // }

                        const language = file.path.split('.').pop() || '';
                        // content += [
                        const content = [
                            `\n\n# File: ${file.path}`,
                            `Source: https://github.com/${githubInfo.owner}/${githubInfo.repo}/blob/${githubInfo.branch}/${file.path}`,
                            '',
                            '```' + language,
                            fileContent,
                            '```',
                            '---\n'
                        ].join('\n');

                        await this.saveToFile(content, true);
                        

                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        webview.postMessage({
                            type: 'status',
                            message: `Error processing ${file.path}: ${errorMessage}`,
                            isError: true
                        });
                        await this.saveToFile(`\n\n# Error processing ${file.path}\n\n${errorMessage}\n\n---\n`, true);
                    }
                }

                const finalMessage = this._stopCrawling ? 
                    `Crawling stopped by user. \nProcessed ${currentFile} of ${totalFiles} files.` :
                    `Completed! \nProcessed ${currentFile} of ${totalFiles} files.`;

                webview.postMessage({
                    type: 'status',
                    message: finalMessage
                });
                const endTime = new Date();
                const duration = (endTime.getTime() - startTime.getTime()) / 1000;
                
                const stats = [
                    '\n\n# Crawl Statistics',
                    '',
                    `- **Start URL:** ${startUrl}`,
                    `- **Repository:** ${githubInfo.owner}/${githubInfo.repo}`,
                    `- **Branch:** ${githubInfo.branch}`,
                    `- **Depth:** ${depth}`,
                    `- **Files processed:** ${currentFile}`,
                    `- **Total files found:** ${totalFiles}`,
                    `- **Crawl method:** ${method}`,
                    `- **Duration:** ${duration.toFixed(2)} seconds`,
                    `- **Crawl completed:** ${endTime.toLocaleString()}`
                ].join('\n');

                await this.saveToFile(stats, true);

                webview.postMessage({
                    type: 'checkAutoOpen',
                    filePath: this._outputFile
                });

            } catch (error) {
                console.error('Error processing repository:', error);
                webview.postMessage({
                    type: 'status',
                    message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    isError: true
                });
            }
        } else {
            // const startTime = new Date(); 
            const visited = new Set<string>();
            const toVisit: Array<{url: string; depth: number}> = [{url: startUrl, depth: 0}];
            const plannedVisits = new Set([startUrl]);
            let currentPage = 0;

            // Parse the initial URL for reference
            const baseUrlObj = new URL(startUrl);
            const basePathParts = baseUrlObj.pathname.split('/').filter(Boolean);

            const isWithinDocs = (url: string): boolean => {
                try {
                    const urlObj = new URL(url);
                    
                    // Check if same hostname
                    if (urlObj.hostname !== baseUrlObj.hostname) {
                        return false;
                    }

                    // Get path parts for comparison
                    const urlPathParts = urlObj.pathname.split('/').filter(Boolean);
                    
                    // Check if the URL path starts with the base path
                    for (let i = 0; i < basePathParts.length; i++) {
                        if (urlPathParts[i] !== basePathParts[i]) {
                            return false;
                        }
                    }

                    // Calculate the depth difference
                    const depthDifference = urlPathParts.length - basePathParts.length;
                    
                    // URL must not go above the base path and must be within allowed depth
                    return depthDifference >= 0 && depthDifference < depth;
                } catch {
                    return false;
                }
            };

            const getLinks = async (url: string): Promise<string[]> => {
                try {
                    const response = await axios.get(url, { 
                        timeout: 30000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });
                    const html = response.data;
                    const links: string[] = [];
                    
                    const hrefRegex = /href=["']([^"']+)["']/g;
                    let match;
                    
                    while ((match = hrefRegex.exec(html)) !== null) {
                        try {
                            const href = match[1];
                            if (href.startsWith('#') || 
                                href.startsWith('javascript:') || 
                                href.match(/\.(pdf|zip|rar|exe|dmg|pkg|deb|rpm)$/i)) {
                                continue;
                            }
                            const fullUrl = new URL(href, url).href;
                            if (fullUrl.startsWith('http') && isWithinDocs(fullUrl)) {
                                links.push(fullUrl);
                            }
                        } catch (e) {
                            console.error('Invalid URL:', e);
                        }
                    }
                    
                    return [...new Set(links)];
                } catch (error) {
                    console.error(`Error fetching links from ${url}:`, error);
                    return [];
                }
            };

            webview.postMessage({
                type: 'status',
                message: `Starting crawl from ${startUrl} with depth ${depth}`
            });

            while (toVisit.length > 0 && !this._stopCrawling) {
                const current = toVisit.shift()!;
                const currentUrl = current.url;
                const currentDepth = current.depth;

                if (visited.has(currentUrl) || currentDepth >= depth) {
                    continue;
                }

                currentPage++;
                visited.add(currentUrl);

                webview.postMessage({
                    type: 'status',
                    message: `[${currentPage}/${plannedVisits.size}] ${currentUrl}\nDepth: ${currentDepth}/${depth}`
                });

                try {
                    // Get the markdown content using selected method
                    const pageContent = await this.getPageContent(currentUrl, method);
                    
                    // Make content formatting more consistent with GitHub branch
                    const content = [
                        `\n\n# Source: ${currentUrl}`,
                        '',
                        pageContent,
                        '---\n'
                    ].join('\n');
                    
                    await this.saveToFile(content, true);

                    // Only get links if we haven't reached max depth
                    if (currentDepth < depth - 1) {  // Important change here
                        webview.postMessage({
                            type: 'status',
                            message: `Finding links in ${currentUrl}...`
                        });

                        const links = await getLinks(currentUrl);
                        let newLinks = 0;

                        for (const link of links) {
                            if (!visited.has(link) && !plannedVisits.has(link)) {
                                toVisit.push({url: link, depth: currentDepth + 1});
                                plannedVisits.add(link);
                                newLinks++;
                            }
                        }

                        webview.postMessage({
                            type: 'status',
                            message: `Found ${newLinks} new links in ${currentUrl}`
                        });
                    }

                    if (method === 'api') {
                        // Only add delay for API method
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    webview.postMessage({
                        type: 'status',
                        message: `Error processing ${currentUrl}: ${errorMessage}`,
                        isError: true
                    });
                    await this.saveToFile(`\n\n# Error processing ${currentUrl}\n\n${errorMessage}\n\n---\n`, true);
                }
            }

            const finalMessage = this._stopCrawling ? 
                `Crawling stopped by user. Processed ${currentPage} pages.` :
                `Completed! Processed ${currentPage} pages.`;

            webview.postMessage({
                type: 'status',
                message: finalMessage
            });

            // Save final statistics
            const endTime = new Date();
            const duration = (endTime.getTime() - startTime.getTime()) / 1000;

            const stats = [
                '\n\n# Crawl Statistics',
                '',
                `- **Start URL:** ${startUrl}`,
                `- **Depth:** ${depth}`,
                `- **Pages visited:** ${visited.size}`,
                `- **Crawl method:** ${method}`,
                `- **Duration:** ${duration.toFixed(2)} seconds`,
                `- **Crawl completed:** ${new Date().toLocaleString()}`
            ].join('\n');
            await this.saveToFile(stats, true);

            // Send message to webview to check auto-open setting
            webview.postMessage({
                type: 'checkAutoOpen',
                filePath: this._outputFile
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'styles.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.js'));
        
        // Read the HTML template
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'index.html').fsPath;
        let htmlContent = fs.readFileSync(htmlPath, 'utf8');
        
        // Replace placeholders with actual URIs
        htmlContent = htmlContent.replace('${stylesUri}', stylesUri.toString());
        htmlContent = htmlContent.replace('${scriptUri}', scriptUri.toString());
        
        return htmlContent;
    }
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new DocsMinerViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DocsMinerViewProvider.viewType, provider)
    );
}
