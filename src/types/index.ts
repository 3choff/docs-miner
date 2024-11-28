import * as vscode from 'vscode';

export interface CrawlOptions {
    url: string;
    depth: number;
    method: 'api' | 'browser';
    outputFolder?: string;
    outputFileName?: string;
}

export interface CrawlStats {
    pagesProcessed: number;
    totalPages: number;
    startTime: Date;
    endTime?: Date;
}

export interface GithubInfo {
    owner: string;
    repo: string;
    type: string;
    branch: string;
    basePath: string;
    isSpecificPath: boolean;
}

export interface ICrawlerService {
    crawl(options: CrawlOptions, webview: vscode.Webview): Promise<void>;
    stop(): void;
}

export interface IContentProcessor {
    processContent(url: string, content: string): Promise<string>;
    convertToMarkdown(html: string): string;
}

export interface IFileService {
    saveContent(content: string, append?: boolean): Promise<void>;
    createOutputPath(baseUrl: string, outputFolder?: string, outputFileName?: string): string;
    getOutputFile(): string | undefined;
}
