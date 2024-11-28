import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CrawlOptions } from './types';
import { CrawlerService } from './services/CrawlerService';
import { ContentProcessor } from './services/ContentProcessor';
import { FileService } from './services/FileService';

export class ViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'docsMinerView';
    private _view?: vscode.WebviewView;
    private crawlerService?: CrawlerService;
    private fileService?: FileService;

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
                case 'startCrawl': {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders) {
                        vscode.window.showErrorMessage('Please open a workspace first');
                        return;
                    }

                    const workspaceFolder = workspaceFolders[0].uri.fsPath;
                    this.fileService = new FileService(workspaceFolder);
                    const contentProcessor = new ContentProcessor();
                    this.crawlerService = new CrawlerService(contentProcessor, this.fileService);

                    const options: CrawlOptions = {
                        url: data.url,
                        depth: data.depth,
                        method: data.method,
                        outputFolder: data.outputFolder,
                        outputFileName: data.outputFileName
                    };

                    try {
                        const outputPath = this.fileService.createOutputPath(options.url, options.outputFolder, options.outputFileName);
                        await this.crawlerService.crawl(options, webviewView.webview);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(`Error during crawling: ${errorMessage}`);
                    }
                    break;
                }

                case 'stopCrawl': {
                    if (this.crawlerService) {
                        this.crawlerService.stop();
                        webviewView.webview.postMessage({
                            type: 'status',
                            message: 'Stopping crawl... \nPlease wait for current page to finish.'
                        });
                    }
                    break;
                }

                case 'openFile': {
                    const outputFile = this.fileService?.getOutputFile();
                    if (outputFile) {
                        const doc = await vscode.workspace.openTextDocument(outputFile);
                        await vscode.window.showTextDocument(doc);
                    }
                    break;
                }

                case 'selectFile': {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders) {
                        vscode.window.showErrorMessage('Please open a workspace first');
                        return;
                    }
                    const options: vscode.OpenDialogOptions = {
                        canSelectMany: false,
                        openLabel: 'Select',
                        filters: {
                            'Markdown': ['md']
                        }
                    };
                    
                    const fileUri = await vscode.window.showOpenDialog(options);
                    if (fileUri && fileUri[0]) {
                        const filePath = fileUri[0].fsPath;
                        const workspacePath = workspaceFolders[0].uri.fsPath
                        // Send the selected file path back to the webview
                        webviewView.webview.postMessage({
                            type: 'fileSelected',
                            filePath: filePath,
                            workspacePath: workspacePath
                        });
                    }
                    break;
                }
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'styles.css'));
        
        // Get path to index.html
        const indexPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview', 'index.html');
        let htmlContent = fs.readFileSync(indexPath.fsPath, 'utf-8');
        
        // Replace placeholders with actual URIs
        htmlContent = htmlContent
            .replace('${scriptUri}', scriptUri.toString())
            .replace('${styleUri}', styleUri.toString());
            
        return htmlContent;
    }
}
