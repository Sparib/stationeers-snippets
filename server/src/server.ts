/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { list } from './list';
import { setFlagsFromString } from 'v8';
import { FileSystem } from 'vscode-languageserver/lib/node/files';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = true;
let hasWorkspaceFolderCapability = true;
let hasDiagnosticRelatedInformationCapability = true;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [">"]
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	const settings = await getDocumentSettings(textDocument.uri);

	// The validator creates diagnostics for all uppercase words length 2 and more
	const text = textDocument.getText();
	const pattern = /<PrefabName>.+<\/PrefabName>/g;
	let m: RegExpExecArray | null;

	let problems = 0;
	const diagnostics: Diagnostic[] = [];
	while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
		problems++;
		// const diagnostic: Diagnostic = {
		// 	severity: DiagnosticSeverity.Warning,
		// 	range: {
		// 		start: textDocument.positionAt(m.index),
		// 		end: textDocument.positionAt(m.index + m[0].length)
		// 	},
		// 	message: `${m[0]} is all uppercase.`,
		// 	source: 'ex'
		// };
		// if (hasDiagnosticRelatedInformationCapability) {
		// 	diagnostic.relatedInformation = [
		// 		{
		// 			location: {
		// 				uri: textDocument.uri,
		// 				range: Object.assign({}, diagnostic.range)
		// 			},
		// 			message: 'Spelling matters'
		// 		},
		// 		{
		// 			location: {
		// 				uri: textDocument.uri,
		// 				range: Object.assign({}, diagnostic.range)
		// 			},
		// 			message: 'Particularly for names'
		// 		}
		// 	];
		// }
		const name = m[0].replace("<PrefabName>", "").replace("</PrefabName>", "");

		if (!list["items"].includes(name)) {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				range: {
					start: textDocument.positionAt(m.index + 12),
					end: textDocument.positionAt(m.index + m[0].length - 13)
				},
				message: `${name} is not a valid name.`,
				source: 'Stationeers Prefab Name List'
			};
		
			diagnostics.push(diagnostic);
		}
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// connection.terminated(); print("I'm sorry Elizabeth");

let lineText = "";

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		const document = documents.get(_textDocumentPosition.textDocument.uri);
		if (document == null) { return []; }
		const text = document.getText();
		const lines = text.split(/r?n/g);
		const position = _textDocumentPosition.position;
		const linePrefix = lines[position.line].substring(0, position.character);
		lineText = lines[position.line];

		if (!linePrefix.endsWith('<PrefabName>')) {
			return [];
		}

		const completionItems: CompletionItem[] = [];

		for (const i in list["items"]) {
			const item = list["items"][i];
			completionItems.push({label: item, kind: CompletionItemKind.Constant, data: i});
		}

		return completionItems;
	}
);

connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (!lineText.endsWith("</PrefabName>")) {
			item.label += "</PrefabName>";
		}
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();