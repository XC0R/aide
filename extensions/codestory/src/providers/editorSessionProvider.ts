/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RepoRef, SideCarClient } from '../sidecar/client';
import { v4 as uuidv4 } from 'uuid';
import { getCodeSelection } from '../editor/codeSelection';
import { InEditorRequest } from '../sidecar/types';
import { reportFromStreamToEditorSessionProgress } from './reportEditorSessionAnswerStream';

export enum IndentStyle {
	Tabs = 'tabs',
	Spaces = 'spaces'
}

interface IndentStyleSpaces {
	kind: IndentStyle;
	indentSize: number | null;
}

class IndentationUtils {
	private spacePatterns: Map<number, RegExp>;
	private readonly tabPattern: RegExp;

	constructor() {
		this.spacePatterns = new Map();
		this.tabPattern = /^(\t+)/;
	}

	/**
	 * Determines the indentation of a given line.
	 *
	 * @param line The line to inspect.
	 * @param useSpaces Whether to look for spaces (true) or tabs (false).
	 * @param spaceCount If using spaces, the number of spaces per indent.
	 * @returns A tuple where the first element is the whitespace string and the second is the indent count.
	 */
	guessIndent(line: string, useSpaces: boolean, spaceCount?: number): [string, number] {
		const pattern = useSpaces ? this.getSpacePattern(spaceCount!) : this.tabPattern;
		const match = line.match(pattern);
		return match ? [match[0], match[0].length / (useSpaces ? spaceCount! : 1)] : ['', 0];
	}

	/**
	 * Retrieves (or generates) the regex pattern for a given space count.
	 *
	 * @param count The number of spaces per indent.
	 * @returns The corresponding regex pattern.
	 */
	private getSpacePattern(count: number): RegExp {
		if (!this.spacePatterns.has(count)) {
			this.spacePatterns.set(count, new RegExp(`^(( {${count}})+)`));
		}
		return this.spacePatterns.get(count)!;
	}
}

export class IndentationHelper {
	static getLeadingWhitespace(line: string) {
		for (let i = 0; i < line.length; i++) {
			const charCode = line.charCodeAt(i);
			if (charCode !== 32 && charCode !== 9) {
				console.log('how many characters we matched' + i);
				return line.substring(0, i);
			}
		}
		return line;
	}

	static guessIndentStyleFromLeadingWhitespace(whitespace: string): IndentStyleSpaces | null {
		if (!whitespace || whitespace === ' ') {
			console.log('we got a single whitespace here');
			return null;
		}
		if (/\t/.test(whitespace)) {
			console.log('we are passing here??? for tabs');
			return { kind: IndentStyle.Tabs, indentSize: null };
		}
		const spaceMatch = whitespace.match(/( +)/);
		if (spaceMatch) {
			const spaceCount = spaceMatch[1].length;
			return {
				kind: IndentStyle.Spaces,
				indentSize: spaceCount === 2 ? spaceCount : 4
			};
		}
		console.log('are we returning null here');
		return null;
	}

	static guessIndentStyleFromLine(line: string) {
		console.log('indent style debugging');
		console.log(line);
		const leadingWhitespace = this.getLeadingWhitespace(line);
		console.log(leadingWhitespace);
		const result = this.guessIndentStyleFromLeadingWhitespace(leadingWhitespace);
		console.log('guessing indent style for whitespace');
		console.log(result);
		return result;
	}

	// we get the whitespace string and the indent level this way for the string we want to add
	static guessIndentLevel(line: string, indentStyle: IndentStyleSpaces): [string, number] {
		const indentationUtils = new IndentationUtils();
		// U_(e, r.kind === "spaces", r.kind === "spaces" ? r.indentSize : 1) }
		const [whiteSpaceString, indentationLevel] = indentationUtils.guessIndent(line, indentStyle.kind === IndentStyle.Spaces, indentStyle.indentSize ?? 1);
		return [whiteSpaceString, indentationLevel];
	}

	static getDocumentIndentStyle(lines: string[], defaultStyle: IndentStyleSpaces | undefined) {
		for (const line of lines) {
			const style = this.guessIndentStyleFromLine(line);
			console.log('what is the indent style for sub-line');
			console.log(style);
			if (style) {
				return style;
			}
		}
		return defaultStyle || { kind: IndentStyle.Tabs, indentSize: null };
	}
}


export class CSInteractiveEditorSession implements vscode.CSChatEditorSession {
	placeholder?: string;
	slashCommands?: vscode.CSChatEditorSlashCommand[];
	wholeRange?: vscode.Range;
	message?: string;
	textDocument: vscode.TextDocument;
	range: vscode.Range;
	threadId: string;

	constructor(textDocument: vscode.TextDocument, range: vscode.Range) {
		this.placeholder = 'Ask Aide or type \'/\' for commands';
		this.slashCommands = [
			{
				command: 'doc',
				refer: true,
				detail: 'Generate documentation for the selected code',
				executeImmediately: false,
			},
		];
		this.threadId = uuidv4();
		this.textDocument = textDocument;
		this.wholeRange = range;
		this.message = 'Aide generated code might be incorrect';
		this.range = range;
	}

	getTextDocumentLanguage(): string {
		return this.textDocument.languageId;
	}
}

// export interface InteractiveEditorMessageResponse {
// 	contents: MarkdownString;
// 	placeholder?: string;
// 	wholeRange?: Range;
// }

export class CSInteractiveEditorProgressItem implements vscode.CSChatEditorProgressItem {
	message?: string;
	edits?: vscode.TextEdit[];
	editsShouldBeInstant?: boolean;
	slashCommand?: vscode.CSChatEditorSlashCommand;
	content?: string | vscode.MarkdownString;

	static normalMessage(message: string): CSInteractiveEditorProgressItem {
		return {
			message: message,
		};
	}

	static documentationGeneration(): CSInteractiveEditorProgressItem {
		return {
			slashCommand: {
				command: 'doc',
				refer: true,
				detail: 'Generate documentation for the selected code',
				executeImmediately: false,
			}
		};
	}
}

export class CSInteractiveEditorMessageResponse implements vscode.CSChatEditorMessageResponse {
	contents: vscode.MarkdownString;
	placeholder?: string;
	wholeRange?: vscode.Range;

	constructor(contents: vscode.MarkdownString, placeholder: string | undefined, wholeRange: vscode.Range) {
		this.contents = contents;
		this.placeholder = placeholder;
		this.wholeRange = wholeRange;
	}
}


export class CSInteractiveEditorResponse implements vscode.CSChatEditorResponse {
	edits: vscode.TextEdit[] | vscode.WorkspaceEdit;
	placeholder?: string;
	wholeRange?: vscode.Range | undefined;

	constructor(edits: vscode.TextEdit[] | vscode.WorkspaceEdit, placeholder: string | undefined, wholeRange: vscode.Range) {
		this.edits = edits;
		this.placeholder = placeholder;
		this.wholeRange = wholeRange;
	}
}

export type CSInteractiveEditorResponseMessage = CSInteractiveEditorResponse | CSInteractiveEditorMessageResponse;

export class CSInteractiveEditorSessionProvider implements vscode.CSChatEditorSessionProvider {
	label: 'cs-chat-editor';
	sidecarClient: SideCarClient;
	repoRef: RepoRef;
	workingDirectory: string;
	constructor(sidecarClient: SideCarClient, repoRef: RepoRef, workingDirectory: string) {
		console.log('we are registering here');
		this.label = 'cs-chat-editor';
		this.sidecarClient = sidecarClient;
		this.repoRef = repoRef;
		this.workingDirectory = workingDirectory;
	}

	prepareCSChatEditorSession(
		context: vscode.TextDocumentContext,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.CSChatEditorSession> {
		const start = context.selection.active;
		const anchor = context.selection.anchor;
		if (vscode.window.activeTextEditor === undefined) {
			throw Error('no active text editor');
		}
		const currentEditorOptions = vscode.window.activeTextEditor?.options;
		let fileIndentInfo;
		if (currentEditorOptions) {
			fileIndentInfo = {
				insertSpaces: currentEditorOptions.insertSpaces,
				tabSize: currentEditorOptions.tabSize
			};
		}
		// const range = new vscode.Range(start.line - 1, start.character, anchor.line + 1, anchor.character);
		return new CSInteractiveEditorSession(context.document, context.selection);
	}

	provideCSChatEditorResponse(
		session: CSInteractiveEditorSession,
		request: vscode.CSChatEditorRequest,
		progress: vscode.Progress<vscode.CSChatEditorProgressItem>,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<CSInteractiveEditorResponseMessage> {
		return (async () => {
			progress.report({
				message: 'Getting the response...',
			});
			// First get the more correct range for this selection
			const text = session.textDocument.getText();
			const startOffset = session.textDocument.offsetAt(session.range.start);
			const endOffset = session.textDocument.offsetAt(session.range.end);
			// Now we want to prepare the data we have to send over the wire
			const context: InEditorRequest = {
				repoRef: this.repoRef.getRepresentation(),
				query: request.prompt,
				threadId: session.threadId,
				language: session.getTextDocumentLanguage(),
				snippetInformation: {
					startPosition: {
						line: session.range.start.line,
						character: session.range.start.character,
						byteOffset: startOffset,
					},
					endPosition: {
						line: session.range.end.line,
						character: session.range.end.character,
						byteOffset: endOffset,
					},
				},
				textDocumentWeb: {
					text,
					language: session.getTextDocumentLanguage(),
					fsFilePath: session.textDocument.fileName,
					relativePath: vscode.workspace.asRelativePath(session.textDocument.fileName),
				},
			};
			console.log('[provideInteractiveEditorResponse]context');
			console.log(context);
			console.log('callling the sidecar client endpoint');
			const messages = await this.sidecarClient.getInLineEditorResponse(context);
			await reportFromStreamToEditorSessionProgress(
				messages,
				progress,
				token,
				this.repoRef,
				this.workingDirectory,
				this.sidecarClient,
				session.getTextDocumentLanguage(),
				session.textDocument,
			);
			console.log('got messages from the sidecar client');
			// Now we have to process the messages here
			// TODO(skcd): Figure out how to handle this properly, cause we want
			// to also do the parsing here
			// use tree sitter to parse the tree and get the range of the symbols
			// send this to the backend as well, we keep one way channel for now

			// We also want to get the other range for this selection which takes
			// into account if a function or a higher level construct is selected
			// Gets the new selection range
			// #TODO(skcd): We want to get some more data:
			// more about what kind of symbols are there and what ranges they are in
			// and the vscode type in rust
			// this.sidecarClient.getInLineEditorResponse(
			// 	request.prompt,
			// 	this.repoRef,
			// 	session.threadId,
			// 	session.getTextDocumentLanguage(),
			// );
			// Next we will query using the sidecar binary to get back the response
			// progress.report({
			// 	message: 'skcd_testing_123',
			// 	edits: [textEdits],
			// 	editsShouldBeInstant: true,
			// });
			// progress.report({
			// 	message: 'skcd_testing_123',
			// 	edits: [textEdits],
			// 	editsShouldBeInstant: true,
			// });
			return new CSInteractiveEditorResponse(
				[],
				'skcd waiting for something',
				session.range,
			);
		})();
	}

	handleCSChatEditorResponseFeedback?(session: CSInteractiveEditorSession, response: CSInteractiveEditorResponseMessage, kind: vscode.CSChatEditorResponseFeedbackKind): void {
		console.log('We are good');
	}
}
