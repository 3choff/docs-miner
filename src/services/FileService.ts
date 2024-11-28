import * as fs from 'fs';
import * as path from 'path';
import { IFileService } from '../types';

export class FileService implements IFileService {
    private outputFile?: string;

    constructor(private workspaceFolder: string) {}

    public async saveContent(content: string, append: boolean = false): Promise<void> {
        if (!this.outputFile) {
            throw new Error('Output file path not set');
        }

        try {
            if (append) {
                await fs.promises.appendFile(this.outputFile, content);
            } else {
                await fs.promises.writeFile(this.outputFile, content);
            }
        } catch (error) {
            console.error('Error saving to file:', error);
            throw error;
        }
    }

    public createOutputPath(baseUrl: string, outputFolder?: string, outputFileName?: string): string {
        let outputPath = this.workspaceFolder;
        if (outputFolder) {
            outputPath = path.join(this.workspaceFolder, outputFolder);
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, { recursive: true });
            }
        }

        let fileName: string;
        if (outputFileName) {
            fileName = outputFileName.endsWith('.md') ? outputFileName : `${outputFileName}.md`;
        } else {
            const urlParts = new URL(baseUrl);
            let urlPath = urlParts.pathname.replace(/\//g, '-');
            urlPath = urlPath.replace(/^-|-$/g, '');
            if (urlPath === '') urlPath = 'home';

            const queryString = urlParts.search.replace(/[?&]/g, '-').replace(/[=]/g, '-');
            const sanitizedQuery = queryString ? `-${queryString.replace(/^-|-$/g, '')}` : '';

            fileName = `${urlParts.hostname}${urlPath}${sanitizedQuery}.md`
                .toLowerCase()
                .replace(/[^a-z0-9\-\.]/g, '-')
                .replace(/-+/g, '-')
                .substring(0, 255);
        }

        this.outputFile = path.join(outputPath, fileName);
        return this.outputFile;
    }

    public getOutputFile(): string | undefined {
        return this.outputFile;
    }
}
