import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

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
                        await this.crawlAndScrape(data.url, data.depth, webviewView.webview);
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

    private async crawlAndScrape(startUrl: string, depth: number, webview: vscode.Webview): Promise<void> {
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
                // Get the markdown content
                const markdownResponse = await axios.get(`https://r.jina.ai/${currentUrl}`, {
                    timeout: 30000,
                    headers: {
                        'Accept': 'text/markdown'
                    }
                });

                // Save this page's content
                const pageContent = `\n\n# ${currentUrl}\n\n${markdownResponse.data}\n\n---\n`;
                await this.saveToFile(pageContent, true);

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
