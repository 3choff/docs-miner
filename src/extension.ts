import * as vscode from 'vscode';
import { ViewProvider } from './ViewProvider';

export function activate(context: vscode.ExtensionContext) {
    const viewProvider = new ViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ViewProvider.viewType, viewProvider)
    );
}

export function deactivate() {}