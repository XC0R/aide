/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SidecarApplyEditsRequest, SidecarApplyEditsResponse } from './types';
import * as vscode from 'vscode';

/**
 * Let's try and apply the edits directly to the codebase without going
 * through the flow of decorations
 */
export async function applyEditsDirectly(
	request: SidecarApplyEditsRequest,
): Promise<SidecarApplyEditsResponse> {
	const filePath = request.fs_file_path;
	const startPosition = request.selected_range.startPosition;
	const endPosition = request.selected_range.endPosition;
	const replacedText = request.edited_content;
	// The position here should replace all the characters in the range for the
	// start line but for the end line we can live with how things are for now
	const range = new vscode.Range(new vscode.Position(startPosition.line, 0), new vscode.Position(endPosition.line, endPosition.character));
	const fileUri = vscode.Uri.file(filePath);

	const workspaceEdit = new vscode.WorkspaceEdit();
	workspaceEdit.replace(fileUri, range, replacedText);
	// apply the edits to it
	await vscode.workspace.applyEdit(workspaceEdit);
	// we also want to save the file at this point after applying the edit
	await vscode.workspace.save(fileUri);

	// we calculate how many lines we get after replacing the text
	// once we make the edit on the range, the new range is presented to us
	// we have to calculate the new range and use that instead
	// simple algo here would be the following:
	const lines = replacedText.split(/\r\n|\r|\n/);
	let lastLineColumn = 0;
	if (lines.length > 0) {
		lastLineColumn = lines[lines.length - 1].length;
	} else {
		lastLineColumn = replacedText.length + startPosition.character;
	}

	const newRange = {
		startPosition: {
			line: startPosition.line,
			character: startPosition.character,
			byteOffset: 0,
		},
		endPosition: {
			line: startPosition.line + replacedText.split(/\r\n|\r|\n/).length,
			character: lastLineColumn,
			byteOffset: 0,
		}
	};

	return {
		fs_file_path: filePath,
		success: true,
		new_range: newRange,
	};
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * We want to apply edits to the codebase over here and try to get this ti work
 */
export async function applyEdits(
	request: SidecarApplyEditsRequest,
	response: vscode.ProbeResponseStream,
	limiter: Limiter<any>,
): Promise<SidecarApplyEditsResponse> {
	// const limiter = new Limiter(1);
	const filePath = request.fs_file_path;
	const startPosition = request.selected_range.startPosition;
	const endPosition = request.selected_range.endPosition;
	const replacedText = request.edited_content;
	// The position here should replace all the characters in the range for the
	// start line but for the end line we can live with how things are for now
	const range = new vscode.Range(new vscode.Position(startPosition.line, 0), new vscode.Position(endPosition.line, endPosition.character));
	const fileUri = vscode.Uri.file(filePath);

	const workspaceEdit = new vscode.WorkspaceEdit();
	workspaceEdit.replace(fileUri, range, replacedText);
	if (request.apply_directly) {
		// apply the edits to it
		await vscode.workspace.applyEdit(workspaceEdit);
		// we also want to save the file at this point after applying the edit
		await vscode.workspace.save(fileUri);
	} else {
		// can we split it by lines here and create a streaming workspace edit just by
		// hacking around things?
		let startIndex = 0;
		const startLineNumber = range.start.line;
		const textLines = replacedText.split('\n').map((lineContent) => {
			startIndex = startIndex + 1;
			return {
				line: startLineNumber + startIndex - 1,
				content: lineContent,
			};
		});
		console.log('applyEdits::text_lines');
		console.log(textLines);
		const editsPromise = [];
		// trying to simulate code edits happening like this
		for (const textLine of textLines) {
			// await Promise.allSettled(editsPromise);
			const lineNumber = textLine.line;
			// we are at the last line where we want to go about making changes, so here we should
			// accumulate the edits and send it over as a single edit for now
			const content = textLine.content;
			// const something = async () => {
			// 	await delay(100);
			// 	const workspaceEdit = new vscode.WorkspaceEdit();
			// 	workspaceEdit.replace(fileUri, new vscode.Range(new vscode.Position(lineNumber, 0), new vscode.Position(lineNumber, 1)), content);
			// 	console.log(workspaceEdit);
			// 	editsPromise.push(response.codeEdit({ edits: workspaceEdit }));
			// 	await response.codeEdit({ edits: workspaceEdit });
			// };
			await limiter.queue(async () => {
				await delay(100);
				const workspaceEdit = new vscode.WorkspaceEdit();
				workspaceEdit.replace(fileUri, new vscode.Range(new vscode.Position(lineNumber, 0), new vscode.Position(lineNumber, 1000)), content);
				console.log(workspaceEdit);
				editsPromise.push(response.codeEdit({ edits: workspaceEdit }));
				await response.codeEdit({ edits: workspaceEdit });
			});
			// editsPromise.push(something());
		}
		// try applying the global edit over here
		// await response.codeEdit({ edits: workspaceEdit });
	}


	// we calculate how many lines we get after replacing the text
	// once we make the edit on the range, the new range is presented to us
	// we have to calculate the new range and use that instead
	// simple algo here would be the following:
	const lines = replacedText.split(/\r\n|\r|\n/);
	let lastLineColumn = 0;
	if (lines.length > 0) {
		lastLineColumn = lines[lines.length - 1].length;
	} else {
		lastLineColumn = replacedText.length + startPosition.character;
	}

	const newRange = {
		startPosition: {
			line: startPosition.line,
			character: startPosition.character,
			byteOffset: 0,
		},
		endPosition: {
			line: startPosition.line + replacedText.split(/\r\n|\r|\n/).length,
			character: lastLineColumn,
			byteOffset: 0,
		}
	};

	return {
		fs_file_path: filePath,
		success: true,
		new_range: newRange,
	};
}

export interface ITask<T> {
	(): T;
}

export interface ILimiter<T> {

	readonly size: number;

	queue(factory: ITask<Promise<T>>): Promise<T>;

	clear(): void;
}

interface ILimitedTaskFactory<T> {
	factory: ITask<Promise<T>>;
	c: (value: T | Promise<T>) => void;
	e: (error?: unknown) => void;
}

/**
 * A helper to queue N promises and run them all with a max degree of parallelism. The helper
 * ensures that at any time no more than M promises are running at the same time.
 */
export class Limiter<T> implements ILimiter<T> {

	private _size = 0;
	private _isDisposed = false;
	private runningPromises: number;
	private readonly maxDegreeOfParalellism: number;
	private readonly outstandingPromises: ILimitedTaskFactory<T>[];
	private readonly _onDrained: vscode.EventEmitter<void>;

	constructor(maxDegreeOfParalellism: number) {
		this.maxDegreeOfParalellism = maxDegreeOfParalellism;
		this.outstandingPromises = [];
		this.runningPromises = 0;
		this._onDrained = new vscode.EventEmitter<void>();
	}


	get size(): number {
		return this._size;
	}

	queue(factory: ITask<Promise<T>>): Promise<T> {
		if (this._isDisposed) {
			throw new Error('Object has been disposed');
		}
		this._size++;

		return new Promise<T>((c, e) => {
			this.outstandingPromises.push({ factory, c, e });
			this.consume();
		});
	}

	private consume(): void {
		while (this.outstandingPromises.length && this.runningPromises < this.maxDegreeOfParalellism) {
			const iLimitedTask = this.outstandingPromises.shift()!;
			this.runningPromises++;

			const promise = iLimitedTask.factory();
			promise.then(iLimitedTask.c, iLimitedTask.e);
			promise.then(() => this.consumed(), () => this.consumed());
		}
	}

	private consumed(): void {
		if (this._isDisposed) {
			return;
		}
		this.runningPromises--;
		if (--this._size === 0) {
			// this._onDrained.fire();
		}

		if (this.outstandingPromises.length > 0) {
			this.consume();
		}
	}

	clear(): void {
		if (this._isDisposed) {
			throw new Error('Object has been disposed');
		}
		this.outstandingPromises.length = 0;
		this._size = this.runningPromises;
	}

	dispose(): void {
		this._isDisposed = true;
		this.outstandingPromises.length = 0; // stop further processing
		this._size = 0;
		this._onDrained.dispose();
	}
}
