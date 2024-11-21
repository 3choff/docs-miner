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
                        message: 'Stopping crawl... Please wait for current page to finish.'
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
            
            await page.goto(url, { waitUntil: 'networkidle0' });
            
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
                    // Keep code blocks that are likely documentation examples
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
                // replacement: (content: string): string => {
                //     // Preserve code blocks with appropriate formatting
                //     return '\n```\n' + content + '\n```\n';
                // }
                replacement: function(content: string, node): string {
                    // Type assertion since we know this will be an HTMLElement from our filter
                    const element = node as HTMLElement;
                    
                    // Get the language if specified
                    const language = element.getAttribute('data-language') || 
                                    element.getAttribute('class')?.match(/language-(\w+)/)?.[1] ||
                                    '';
                                    
                    // Clean up the content
                    const cleanContent = content
                        .trim()                         // Remove extra whitespace
                        .replace(/^\s+|\s+$/gm, '')    // Remove leading/trailing spaces per line
                        .replace(/```/g, '′′′');       // Replace any existing backticks to prevent nesting issues
            
                    // Format the code block properly
                    return `\n\n\`\`\`${language}\n${cleanContent}\n\`\`\`\n\n`;
                }
            });
            
            const markdown = turndownService.turndown(content);
            
            // Format the content with metadata to match API output
            const formattedContent = [
                `Title: ${pageTitle}`,
                `URL Source: ${url}`,
                'Markdown Content:',
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

    private async crawlAndScrape(startUrl: string, depth: number, webview: vscode.Webview, method: string): Promise<void> {
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
                message: `[${currentPage}/${plannedVisits.size}] Processing: ${currentUrl} (Depth: ${currentDepth}/${depth})`
            });

            try {
                // Get the markdown content using selected method
                const pageContent = await this.getPageContent(currentUrl, method);
                
                // Save this page's content
                const content = `\n\n# ${currentUrl}\n\n${pageContent}\n\n---\n`;
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

                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Error processing ${currentUrl}:`, error);
                // Save error information to the file
                const errorContent = `\n\n# Error processing ${currentUrl}\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\n---\n`;
                await this.saveToFile(errorContent, true);
                
                webview.postMessage({
                    type: 'status',
                    message: `Error processing ${currentUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    isError: true
                });
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
        const stats = `\n\n# Crawl Statistics\n\n- Total pages processed: ${currentPage}\n- Total unique URLs found: ${plannedVisits.size}\n- Crawl completed: ${new Date().toISOString()}\n`;
        await this.saveToFile(stats, true);

        // Send message to webview to check auto-open setting
        webview.postMessage({
            type: 'checkAutoOpen',
            filePath: this._outputFile
        });
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
