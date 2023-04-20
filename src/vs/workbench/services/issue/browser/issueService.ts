/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { normalizeGitHubUrl } from 'vs/platform/issue/common/issueReporterUtil';
import { IExtensionManagementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionType } from 'vs/platform/extensions/common/extensions';
import { IProductService } from 'vs/platform/product/common/productService';
import { IIssueUriRequestHandler, IWorkbenchIssueService } from 'vs/workbench/services/issue/common/issue';
import { IssueReporterData } from 'vs/platform/issue/common/issue';
import { userAgent } from 'vs/base/common/platform';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';

export class WebIssueService implements IWorkbenchIssueService {
	declare readonly _serviceBrand: undefined;

	private readonly _handlers = new Map<string, IIssueUriRequestHandler>();

	constructor(
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService
	) { }

	//TODO @TylerLeonhardt @Tyriar to implement a process explorer for the web
	async openProcessExplorer(): Promise<void> {
		console.error('openProcessExplorer is not implemented in web');
	}

	async openReporter(options: Partial<IssueReporterData>): Promise<void> {
		let repositoryUrl = this.productService.reportIssueUrl;
		let selectedExtension: ILocalExtension | undefined;
		if (options.extensionId) {
			if (this._handlers.has(options.extensionId)) {
				try {
					const uri = await this.getIssueReporterUri(options.extensionId, CancellationToken.None);
					repositoryUrl = uri.toString(true);
				} catch (e) {
					this.logService.error(e);
				}
			}

			// if we don't have a handler, or the handler failed, try to get the extension's github url
			if (!repositoryUrl) {
				const extensions = await this.extensionManagementService.getInstalled(ExtensionType.User);
				selectedExtension = extensions.filter(ext => ext.identifier.id === options.extensionId)[0];
				const extensionGitHubUrl = this.getExtensionGitHubUrl(selectedExtension);
				if (extensionGitHubUrl) {
					repositoryUrl = `${extensionGitHubUrl}/issues/new`;
				}
			}
		}

		if (repositoryUrl) {
			repositoryUrl = `${repositoryUrl}?body=${encodeURIComponent(await this.getIssueDescription(selectedExtension))}&labels=web`;
			dom.windowOpenNoOpener(repositoryUrl);
		} else {
			throw new Error(`Unable to find issue reporting url for ${options.extensionId}`);
		}
	}

	registerIssueUriRequestHandler(extensionId: string, handler: IIssueUriRequestHandler): IDisposable {
		this._handlers.set(extensionId, handler);
		return toDisposable(() => this._handlers.delete(extensionId));
	}

	private async getIssueReporterUri(extensionId: string, token: CancellationToken): Promise<URI> {
		const handler = this._handlers.get(extensionId);
		if (!handler) {
			throw new Error(`No handler registered for extension ${extensionId}`);
		}
		return handler.provideIssueUrl(token);
	}

	private getExtensionGitHubUrl(extension: ILocalExtension): string {
		let repositoryUrl = '';

		const bugsUrl = extension?.manifest.bugs?.url;
		const extensionUrl = extension?.manifest.repository?.url;

		// If given, try to match the extension's bug url
		if (bugsUrl && bugsUrl.match(/^https?:\/\/github\.com\/(.*)/)) {
			repositoryUrl = normalizeGitHubUrl(bugsUrl);
		} else if (extensionUrl && extensionUrl.match(/^https?:\/\/github\.com\/(.*)/)) {
			repositoryUrl = normalizeGitHubUrl(extensionUrl);
		}

		return repositoryUrl;
	}

	private async getIssueDescription(extension: ILocalExtension | undefined): Promise<string> {
		return `ADD ISSUE DESCRIPTION HERE

Version: ${this.productService.version}
Commit: ${this.productService.commit ?? 'unknown'}
User Agent: ${userAgent ?? 'unknown'}
Embedder: ${this.productService.embedderIdentifier ?? 'unknown'}
${extension?.manifest.version ? `\nExtension version: ${extension.manifest.version}` : ''}
<!-- generated by web issue reporter -->`;
	}
}