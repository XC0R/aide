/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Definition, LocationLink, Position, TextDocument, languages, workspace, Location } from 'vscode';
import { v4 as uuidv4 } from 'uuid';
const Parser = require('web-tree-sitter');
import * as path from 'path';
import * as fs from 'fs';
import { getSymbolsFromDocumentUsingLSP } from '../utilities/lspApi';
import { CodeSymbolInformation } from '../utilities/types';
import { promisify } from 'util';
import { exec } from 'child_process';
import logger from '../logger';
import { column } from 'mathjs';

// This is the tree sitter parser we are using for parsing
// the file system
let GO_PARSER: any | null = null;


const setGoParser = async () => {
	if (GO_PARSER) {
		return;
	}
	await Parser.init();
	const parser = new Parser();
	const filePath = path.join(__dirname, 'tree-sitter-go.wasm');
	const goLang = await Parser.Language.load(filePath);
	parser.setLanguage(goLang);
	GO_PARSER = parser;
};


export interface GoParserNodeInformation {
	'type': string;
	'startLine': number;
	'StartColumn': number;
	'endLine': number;
	'endColumn': number;
	'text': string[];
}

async function runCommand(cmd: string): Promise<[string, string | undefined]> {
	let stdout = '';
	let stderr = '';
	try {
		const output = await promisify(exec)(cmd, {
			shell: process.platform === 'win32' ? 'powershell.exe' : undefined,
		});
		stdout = output.stdout;
		stderr = output.stderr;
	} catch (e: any) {
		stderr = e.stderr;
		stdout = e.stdout;
	}

	const stderrOrUndefined = stderr === '' ? undefined : stderr;
	return [stdout, stderrOrUndefined];
}


const parseGoLangCodeUsingTreeSitter = (code: string): GoParserNodeInformation[] => {
	const parsedNode = GO_PARSER.parse(code);
	const rootNode = parsedNode.rootNode;
	const nodes: GoParserNodeInformation[] = [];
	const traverse = (node: any) => {
		if (node.type === 'identifier' || node.type === 'field_identifier') {
			nodes.push({
				type: node.type,
				startLine: node.startPosition.row,
				StartColumn: node.startPosition.column,
				endLine: node.endPosition.row,
				endColumn: node.endPosition.column,
				text: node.text,
			});
		}
		for (const child of node.children) {
			traverse(child);
		}
	};
	traverse(rootNode);
	return nodes;
}


export const definitionInformation = (
	definition: Definition | LocationLink[],
): {
	fsFilePath: string;
	startPosition: Position;
} | null => {
	if (Array.isArray(definition)) {
		// This can be either of type LocationLink or Location[], so we need
		// to check what type it is and infer that here
		if (definition.length === 0) {
			return null;
		}
		// We pick up the first location always, we should probably figure out
		// the correct thing to do here later on
		if ('originSelectionRange' in definition[0]) {
			const locationLinks = definition as LocationLink[];
			for (let index = 0; index < locationLinks.length; index++) {
				const locationLink = locationLinks[index];
				const filePath = locationLink.targetUri.fsPath;
				const lineNumber = locationLink.targetRange.start;
				return {
					fsFilePath: filePath,
					startPosition: lineNumber,
				};
			}
		} else {
			// This is of type Location[]
			const locations = definition as Location[];
			for (let index = 0; index < locations.length; index++) {
				const location = locations[index];
				const filePath = location.uri.fsPath;
				const lineNumber = location.range.start;
				return {
					fsFilePath: filePath,
					startPosition: lineNumber,
				};
			}
		}
	} else {
		return {
			fsFilePath: definition.uri.fsPath,
			startPosition: definition.range.start,
		};
	}
	return null;
};


export const getGoToDefinition = async (
	textDocument: TextDocument,
	lineNumber: number,
	columnNumber: number,
	currentCodeSymbol: string,
	dependencyStrings: string[],
): Promise<{
	fsFilePath: string;
	startPosition: Position;
} | null> => {
	const referencesProviders = languages.getDefinitionProvider({
		language: 'typescript',
		scheme: 'file',
	});
	for (let index = 0; index < referencesProviders.length; index++) {
		try {
			logger.info('[getGoToDefinition] ' + currentCodeSymbol + ' ' + lineNumber + ' ' + columnNumber + ' ' + dependencyStrings);
			const definitions = await referencesProviders[index].provideDefinition(
				textDocument,
				new Position(lineNumber, columnNumber),
				{
					isCancellationRequested: false,
					onCancellationRequested: () => ({ dispose() { } }),
				}
			);
			logger.info('[getGoToDefinition] definitions ' + JSON.stringify(definitions));
			if (definitions) {
				return definitionInformation(definitions);
			}
		} catch (e) {
			logger.info('[getGoToDefinition] error ' + textDocument.lineAt(lineNumber));
			logger.info('[getGoToDefinition] file line content: ' + textDocument.lineAt(lineNumber).text);
			logger.info('[getGoToDefinition] error for symbol: ' + currentCodeSymbol + ' ' + lineNumber + ' ' + columnNumber + ' ' + dependencyStrings);
			logger.error(e);
		}
	}
	return null;
};

// We are just parsing identifier and field identifier types here
export const parseGoCodeTreeSitter = async (code: string): Promise<GoParserNodeInformation[]> => {
	await setGoParser();
	const parsedNodes = parseGoLangCodeUsingTreeSitter(code);
	return parsedNodes.filter((node) => {
		return node.type === 'identifier' || node.type === 'field_identifier';
	});
};



export class GoLangParser {
	private _workingDirectory: string;
	private _fileToCodeSymbols: Map<string, CodeSymbolInformation[]> = new Map();

	constructor(workingDirectory: string) {
		this._workingDirectory = workingDirectory;
	}

	// This parses the file without resolving the dependencies
	async parseFileWithoutDependency(filePath: string): Promise<CodeSymbolInformation[]> {
		const codeSymbols = await getSymbolsFromDocumentUsingLSP(
			filePath,
			'go',
			this._workingDirectory,
		);
		logger.info('[parseFileWithoutDependency] code symbols: ' + filePath + ' ' + codeSymbols.length);
		this._fileToCodeSymbols.set(filePath, codeSymbols);
		return codeSymbols;
	}

	async getSymbolAtLineNumber(filePath: string, lineNumber: number): Promise<CodeSymbolInformation | null> {
		let codeSymbols = this._fileToCodeSymbols.get(filePath);
		if (!codeSymbols) {
			return null;
		}
		codeSymbols = this._fileToCodeSymbols.get(filePath) ?? [];
		for (let index = 0; index < codeSymbols.length; index++) {
			const codeSymbol = codeSymbols[index];
			if (codeSymbol.symbolStartLine <= lineNumber && codeSymbol.symbolEndLine >= lineNumber) {
				return codeSymbol;
			}
		}
		return null;
	}

	async fixDependenciesForCodeSymbols(filePath: string): Promise<void> {
		const textDocument = await workspace.openTextDocument(filePath);
		const codeSymbolNodes = this._fileToCodeSymbols.get(filePath) ?? [];
		const newCodeSymbols: CodeSymbolInformation[] = [];
		for (let index = 0; index < codeSymbolNodes.length; index++) {
			const currentCodeSymbol = codeSymbolNodes[index];
			logger.info('[fixDependenciesForCodeSymbols] fixing dependencies: ' + currentCodeSymbol.symbolName);
			const startLineCodeSymbolStart = currentCodeSymbol.symbolStartLine;
			const endLineCodeSymbolStart = currentCodeSymbol.symbolEndLine;
			const codeSnippet = currentCodeSymbol.codeSnippet.code;
			const dependentNodes = await parseGoCodeTreeSitter(codeSnippet);
			// Lets fix the position here by first counting the number of tabs at
			// the start of the sentence
			for (let dependencyIndex = 0; dependencyIndex < dependentNodes.length; dependencyIndex++) {
				const dependency = dependentNodes[dependencyIndex];
				if (dependency.text) {
					const startLine = currentCodeSymbol.symbolStartLine + dependency.startLine;
					// maths here is hard but if there are tabs then we are going to subtract the tabs at the start
					const startColumn = dependency.StartColumn;
					const endColumn = dependency.endColumn;
					// Go to definition now
					try {
						const definition = await getGoToDefinition(textDocument, startLine, startColumn, currentCodeSymbol.symbolName, dependency.text);
						logger.info('[fixDependenciesForCodeSymbols] definition: ' + currentCodeSymbol.symbolName + ' ' + startLine + ' ' + startColumn + ' ' + JSON.stringify(definition));
						let codeSymbolForDefinition: CodeSymbolInformation | null = null;
						if (definition === null) {
							continue;
						}
						if (definition.fsFilePath === filePath) {
							if (definition.startPosition.line >= startLineCodeSymbolStart && definition.startPosition.line <= endLineCodeSymbolStart) {
								// We are in the same function block, so no need to regard this as a dependency
							} else {
								// Find the symbol in the filePath whose line start matches up
								codeSymbolForDefinition = await this.getSymbolAtLineNumber(
									definition.fsFilePath,
									definition.startPosition.line,
								);
							}
						} else {
							codeSymbolForDefinition = await this.getSymbolAtLineNumber(
								definition.fsFilePath,
								definition.startPosition.line,
							);
						}
						if (codeSymbolForDefinition) {
							logger.info('[fixDependenciesForCodeSymbols] found dependency: ' + currentCodeSymbol.symbolName + ' ' + codeSymbolForDefinition.symbolName);
							currentCodeSymbol.dependencies.push({
								codeSymbolName: codeSymbolForDefinition.symbolName,
								codeSymbolKind: codeSymbolForDefinition.symbolKind,
								edges: [{
									filePath: definition.fsFilePath,
									codeSymbolName: codeSymbolForDefinition.symbolName,
								}],
							});
						} else {
							logger.info('[fixDependenciesForCodeSymbols] could not find dependency: ' + currentCodeSymbol.symbolName + ' ' + startLine + ' ' + startColumn + ' ' + JSON.stringify(definition));
						}
					} catch (e) {
						logger.info('[fixDependenciesForCodeSymbols] error');
						logger.info(currentCodeSymbol.symbolName + ' ' + startLine + ' ' + startColumn);
						logger.error(e);
					}
				}
			}
			logger.info('[fixDependenciesForCodeSymbols] fixed dependencies: ' + currentCodeSymbol.symbolName + ' ' + currentCodeSymbol.dependencies.length);
			newCodeSymbols.push(currentCodeSymbol);
		}
		this._fileToCodeSymbols.set(filePath, newCodeSymbols);
	}

	// This parses the file and also resolves the dependencies
	// Ideally we will be passing the file -> Vec<CodeSymbolInformation> here
	// but right now we use the instance from the class internally
	async parseFileWithDependencies(filePath: string, useCache: boolean = false): Promise<CodeSymbolInformation[]> {
		if (useCache) {
			const codeSymbols = this._fileToCodeSymbols.get(filePath);
			if (codeSymbols) {
				return codeSymbols;
			}
		}
		const codeSymbols = await this.parseFileWithoutDependency(filePath);
		this._fileToCodeSymbols.set(filePath, codeSymbols);
		await this.fixDependenciesForCodeSymbols(filePath);
		return this._fileToCodeSymbols.get(filePath) ?? [];
	}
}
