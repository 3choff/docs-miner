import * as vscode from 'vscode';
import * as fs from 'fs';
import axios from 'axios';
import PCR from 'puppeteer-chromium-resolver';
import { ICrawlerService, CrawlOptions, GithubInfo } from '../types';
import { ContentProcessor } from './ContentProcessor';
import { FileService } from './FileService';

export class CrawlerService implements ICrawlerService {
    private stopCrawling: boolean = false;
    private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    private readonly EXCLUDED_EXTENSIONS: Map<string, string> = (() => {
        const extensionGroups = {
            'Image file': ['jpg', 'jpeg', 'png', 'gif', 'ico', 'svg'],
            'Font file': ['ttf', 'woff', 'woff2', 'eot'],
            'Audio file': ['mp3', 'wav', 'ogg'],
            'Video file': ['mp4', 'webm', 'avi'],
            'Document file': ['pdf', 'doc', 'docx'],
            'Archive file': ['zip', 'tar', 'gz', 'rar'],
            'Binary executable/library file': ['exe', 'dll', 'so', 'dylib']
        };

        return new Map(
            Object.entries(extensionGroups).flatMap(([reason, extensions]) =>
                extensions.map(ext => [ext, reason])
            )
        );
    })();

    constructor(
        private contentProcessor: ContentProcessor,
        private fileService: FileService
    ) {}

    public stop(): void {
        this.stopCrawling = true;
    }

    public async crawl(options: CrawlOptions, webview: vscode.Webview): Promise<void> {
        this.stopCrawling = false;
        const startTime = new Date();
        // await this.fileService.saveContent('', false);

        // Check if output file exists
        const outputFile = this.fileService.getOutputFile();
        if (!outputFile || !fs.existsSync(outputFile)) {
            // If file doesn't exist, create empty file (current behavior)
            await this.fileService.saveContent('', false);
        }

        try {
            if (options.url.includes('github.com')) {
                await this.crawlGithubRepo(options, webview, startTime);
            } else {
                await this.crawlWebsite(options, webview, startTime);
            }
        } catch (error) {
            this.handleError(error, webview);
        } finally {
            if (this.stopCrawling) {
                webview.postMessage({
                    type: 'status',
                    message: 'Crawling stopped by user'
                });
            }
        }
    }

    private async crawlGithubRepo(options: CrawlOptions, webview: vscode.Webview, startTime: Date): Promise<void> {
        try {
            const githubInfo = this.parseGithubUrl(options.url);
            const initialHeader = [
                `# Repository: ${githubInfo.owner}/${githubInfo.repo}`,
                `## Branch: ${githubInfo.branch}`,
            ].join('\n');
            await this.fileService.saveContent(initialHeader, true);
            webview.postMessage({
                type: 'status',
                message: `Starting GitHub repository crawl: \n${githubInfo.owner}/${githubInfo.repo}`
            });

            const files = await this.getRepoContents(githubInfo.owner, githubInfo.repo, githubInfo.branch);
            const filteredFiles = this.filterFiles(files, githubInfo, options.depth);

            webview.postMessage({
                type: 'status',
                message: `Found ${filteredFiles.length} files to process within depth ${options.depth}`
            });

            const processedFiles = await this.processGithubFiles(filteredFiles, githubInfo, options, webview, startTime);
            
            const finalMessage = this.stopCrawling ? 
                `Crawling stopped by user. \nProcessed ${processedFiles} of ${filteredFiles.length} files.` :
                `Completed! \nProcessed ${processedFiles} of ${filteredFiles.length} files in ${((new Date().getTime() - startTime.getTime()) / 1000).toFixed(1)} seconds.`;

            webview.postMessage({
                type: 'status',
                message: finalMessage
            });

            await this.saveGithubStats(options.url, githubInfo, options.depth, filteredFiles.length, startTime, webview);
        } catch (error) {
            this.handleError(error, webview);
        }
    }

    private parseGithubUrl(url: string): GithubInfo {
        const urlParts = new URL(url);
        const pathParts = urlParts.pathname.split('/').filter(Boolean);
        return {
            owner: pathParts[0],
            repo: pathParts[1],
            type: pathParts[2] || 'tree',
            branch: pathParts[3] || 'main',
            basePath: pathParts.slice(4).join('/'),
            isSpecificPath: pathParts.length > 4
        };
    }

    private async getRepoContents(owner: string, repo: string, branch: string): Promise<any[]> {
        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const response = await axios.get(treeUrl);
        return response.data.tree;
    }

    private filterFiles(files: any[], githubInfo: GithubInfo, depth: number): any[] {
        return files.filter((file: any) => {
            if (file.type !== 'blob') return false;
            
            if (githubInfo.isSpecificPath && !file.path.startsWith(githubInfo.basePath)) {
                return false;
            }

            const relativePath = githubInfo.isSpecificPath 
                ? file.path.slice(githubInfo.basePath.length).replace(/^\//, '')
                : file.path;
            const fileDepth = relativePath.split('/').filter(Boolean).length;
            
            return fileDepth <= depth;
        });
    }

    private async processGithubFiles(
        files: any[],
        githubInfo: GithubInfo,
        options: CrawlOptions,
        webview: vscode.Webview,
        startTime: Date
    ): Promise<number> {
        let currentFile = 0;
        const totalFiles = files.length;

        for (const file of files) {
            if (this.stopCrawling) {
                break;
            }

            currentFile++;
            webview.postMessage({
                type: 'status',
                message: `[${currentFile}/${totalFiles}] ${file.path}\nDepth: ${file.path.split('/').length}/${options.depth}`
            });

            try {
                const extension = file.path.split('.').pop()?.toLowerCase() || '';
                const language = extension;
                let content;

                if (this.EXCLUDED_EXTENSIONS.has(extension)) {
                    // Generate skip message based on extension type
                    const skipReason = this.EXCLUDED_EXTENSIONS.get(extension)!;

                    content = [
                        `\n\n## File: ${file.path}`,
                        `### URL: https://github.com/${githubInfo.owner}/${githubInfo.repo}/blob/${githubInfo.branch}/${file.path}`,
                        '',
                        `Content skipped: ${skipReason}`,
                        '---\n'
                    ].join('\n');
                } else {
                    const rawUrl = `https://raw.githubusercontent.com/${githubInfo.owner}/${githubInfo.repo}/${githubInfo.branch}/${file.path}`;
                    const response = await axios.get(rawUrl, {
                        headers: { 'User-Agent': this.USER_AGENT }
                    });

                    // Handle JSON files specially
                    if (language === 'json') {
                        content = [
                            `\n\n## File: ${file.path}`,
                            `### URL: https://github.com/${githubInfo.owner}/${githubInfo.repo}/blob/${githubInfo.branch}/${file.path}`,
                            '',
                            '```' + language,
                            typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2),
                            '```',
                            '---\n'
                        ].join('\n');
                    } else {
                        content = [
                            `\n\n## File: ${file.path}`,
                            `### URL: https://github.com/${githubInfo.owner}/${githubInfo.repo}/blob/${githubInfo.branch}/${file.path}`,
                            '',
                            '```' + language,
                            response.data,
                            '```',
                            '---\n'
                        ].join('\n');
                    }
                }

                await this.fileService.saveContent(content, true);
            } catch (error) {
                this.handleFileError(error, file.path, webview);
            }
        }

        return currentFile;
    }

    private async crawlWebsite(options: CrawlOptions, webview: vscode.Webview, startTime: Date): Promise<void> {
        const initialHeader = [
            `# Source: ${options.url}`,
        ].join('\n');
        await this.fileService.saveContent(initialHeader, true);
        const visited = new Set<string>();
        const toVisit = [{ url: options.url, depth: 0 }];
        const plannedVisits = new Set([options.url]);
        let currentPage = 0;
        let totalPages = 1;

        const baseUrlObj = new URL(options.url);
        const basePathParts = baseUrlObj.pathname.split('/').filter(Boolean);

        webview.postMessage({
            type: 'status',
            message: `Starting crawl from ${options.url} with depth ${options.depth}`
        });

        while (toVisit.length > 0 && !this.stopCrawling) {
            const current = toVisit.shift()!;
            if (visited.has(current.url) || current.depth >= options.depth) {
                continue;
            }

            currentPage++;
            visited.add(current.url);

            webview.postMessage({
                type: 'status',
                message: `[${currentPage}/${plannedVisits.size}] ${current.url}\nDepth: ${current.depth + 1}/${options.depth}`
            });

            try {
                const pageContent = await this.getPageContent(current.url, options.method);
                
                const formattedContent = [
                    `\n\n## URL: ${current.url}`,
                    '',
                    pageContent,
                    '---\n'
                ].join('\n');

                await this.fileService.saveContent(formattedContent, true);

                if (current.depth < options.depth - 1) {
                    webview.postMessage({
                        type: 'status',
                        message: `Finding links in ${current.url}...`
                    });

                    const links = await this.getLinks(current.url, baseUrlObj, basePathParts, options.depth);
                    let newLinks = 0;

                    for (const link of links) {
                        if (!visited.has(link) && !plannedVisits.has(link)) {
                            toVisit.push({url: link, depth: current.depth + 1});
                            plannedVisits.add(link);
                            newLinks++;
                            totalPages++;
                        }
                    }

                    webview.postMessage({
                        type: 'status',
                        message: `Found ${newLinks} new links in ${current.url}`
                    });
                }

                // Add a small delay between requests to avoid overwhelming the server
                if (options.method === 'api') {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                this.handleError(error, webview);
            }
        }

        const finalMessage = this.stopCrawling ? 
            `Crawling stopped by user. Processed ${currentPage} pages.` :
            `Completed! Processed ${currentPage} pages in ${((new Date().getTime() - startTime.getTime()) / 1000).toFixed(1)} seconds.`;

        webview.postMessage({
            type: 'status',
            message: finalMessage
        });

        await this.saveWebsiteStats(
            options.url,
            options.depth,
            visited,
            startTime,
            options.method,
            webview
        );
    }

    private async saveWebsiteStats(
        startUrl: string,
        depth: number,
        visited: Set<string>,
        startTime: Date,
        method: string,
        webview: vscode.Webview
    ): Promise<void> {
        const endTime = new Date();
        const duration = (endTime.getTime() - startTime.getTime()) / 1000;
        
        const stats = [
            '\n\n# Crawl Statistics',
            '',
            `- **Source:** ${startUrl}`,
            `- **Depth:** ${depth}`,
            `- **Pages processed:** ${visited.size}`,
            `- **Crawl method:** ${method}`,
            `- **Duration:** ${duration.toFixed(2)} seconds`,
            `- **Crawl completed:** ${endTime.toLocaleString()}`,
            ''
        ].join('\n') + '\n';

        await this.fileService.saveContent(stats, true);

        webview.postMessage({
            type: 'checkAutoOpen',
            filePath: this.fileService.getOutputFile()
        });
    }

    private async getPageContent(url: string, method: string): Promise<string> {
        try {
            if (method === 'api') {
                const response = await axios.get(`https://r.jina.ai/${url}`, {
                    timeout: 30000,
                    headers: { 'Accept': 'text/markdown' }
                });
                return response.data;
            } else {
                return this.getContentWithPuppeteer(url);
            }
        } catch (error) {
            throw new Error(`Failed to get content from ${url}: ${error instanceof Error ? error.message : String(error)}`);
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
            await page.setUserAgent(this.USER_AGENT);
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
            
            // Get the page content after JavaScript execution
            const content = await page.evaluate(() => {
                // Remove navigation elements
                const navElements = document.querySelectorAll('nav, header, footer, [role="navigation"], .navigation, .nav, .navbar, .menu, .footer');
                navElements.forEach(nav => nav.remove());

                // Remove SVG elements and images with SVG sources
                const svgElements = document.querySelectorAll('svg, img[src*=".svg"], img[src^="data:image/svg"]');
                svgElements.forEach(svg => {
                    const altText = svg.getAttribute('alt') || svg.getAttribute('title');
                    if (altText) {
                        svg.replaceWith(document.createTextNode(altText));
                    } else {
                        svg.remove();
                    }
                });

                // Remove script tags and their content
                const scripts = document.getElementsByTagName('script');
                while (scripts.length > 0) {
                    scripts[0].parentNode?.removeChild(scripts[0]);
                }
                
                // Remove style tags and their content
                const styles = document.getElementsByTagName('style');
                while (styles.length > 0) {
                    styles[0].parentNode?.removeChild(styles[0]);
                }
                
                // Get the cleaned HTML content
                return document.documentElement.outerHTML;
            });
            
            return await this.contentProcessor.processContent(url, content);
        } catch (error) {
            throw new Error(`Failed to get content with Puppeteer from ${url}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            await browser.close();
        }
    }

    private async getLinks(url: string, baseUrlObj: URL, basePathParts: string[], maxDepth: number): Promise<string[]> {
        try {
            const response = await axios.get(url, { 
                timeout: 30000,
                headers: { 'User-Agent': this.USER_AGENT }
            });
            
            const links: string[] = [];
            const hrefRegex = /href=["']([^"']+)["']/g;
            let match;
            
            while ((match = hrefRegex.exec(response.data)) !== null) {
                try {
                    const href = match[1];
                    if (this.isValidLink(href)) {
                        const fullUrl = new URL(href, url).href;
                        if (fullUrl.startsWith('http') && this.isWithinDocs(fullUrl, baseUrlObj, basePathParts, maxDepth)) {
                            links.push(fullUrl);
                        }
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
    }

    private isValidLink(href: string): boolean {
        return !href.startsWith('#') && 
               !href.startsWith('javascript:') && 
               !href.match(/\.(pdf|zip|tar|gz|rar)$/i);
    }

    private isWithinDocs(url: string, baseUrlObj: URL, basePathParts: string[], maxDepth: number): boolean {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname !== baseUrlObj.hostname) {
                return false;
            }

            const urlPathParts = urlObj.pathname.split('/').filter(Boolean);
            for (let i = 0; i < basePathParts.length; i++) {
                if (urlPathParts[i] !== basePathParts[i]) {
                    return false;
                }
            }

            const depthDifference = urlPathParts.length - basePathParts.length;
            return depthDifference >= 0 && depthDifference < maxDepth;
        } catch {
            return false;
        }
    }

    private async saveGithubStats(
        startUrl: string,
        githubInfo: GithubInfo,
        depth: number,
        totalFiles: number,
        startTime: Date,
        webview: vscode.Webview
    ): Promise<void> {
        const endTime = new Date();
        const duration = (endTime.getTime() - startTime.getTime()) / 1000;
        
        const stats = [
            '\n\n# Crawl Statistics',
            '',
            `- **Source:** ${startUrl}`,
            `- **Repository:** ${githubInfo.owner}/${githubInfo.repo}`,
            `- **Branch:** ${githubInfo.branch}`,
            `- **Depth:** ${depth}`,
            `- **Files processed:** ${totalFiles}`,
            `- **Total files found:** ${totalFiles}`,
            `- **Duration:** ${duration.toFixed(2)} seconds`,
            `- **Crawl completed:** ${endTime.toLocaleString()}`,
            ''
        ].join('\n') + '\n';

        await this.fileService.saveContent(stats, true);

        webview.postMessage({
            type: 'checkAutoOpen',
            filePath: this.fileService.getOutputFile()
        });
    }

    private handleError(error: unknown, webview: vscode.Webview): void {
        console.error('Error during crawling:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        webview.postMessage({
            type: 'status',
            message: `Error: ${errorMessage}`,
            isError: true
        });
    }

    private handleFileError(error: unknown, filePath: string, webview: vscode.Webview): void {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        webview.postMessage({
            type: 'status',
            message: `Error processing ${filePath}: ${errorMessage}`,
            isError: true
        });
        this.fileService.saveContent(`\n\n# Error processing ${filePath}\n\n${errorMessage}\n\n---\n`, true)
            .catch(console.error);
    }
}
