export class Position {
	constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
	constructor(public readonly start: Position, public readonly end: Position) {}
}

export class Location {
	constructor(public readonly uri: Uri, public readonly rangeOrPosition: Range | Position) {}
}

export class Uri {
	private constructor(public readonly path: string) {}
	public static parse(val: string): Uri {
		return new Uri(val);
	}
	public toString(): string {
		return this.path;
	}
}

export const workspace = {
	findFiles: async () => [] as Uri[],
	openTextDocument: async () => ({ getText: () => '', uri: Uri.parse('file:///dummy') }),
	createFileSystemWatcher: () => ({
		onDidChange: () => ({ dispose: () => {} }),
		onDidCreate: () => ({ dispose: () => {} }),
		onDidDelete: () => ({ dispose: () => {} }),
	}),
};

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

export class Diagnostic {
	public source?: string;
	public code?: string | number | { value: string | number; target: Uri };
	constructor(
		public readonly range: Range,
		public readonly message: string,
		public readonly severity: DiagnosticSeverity = DiagnosticSeverity.Error,
	) {}
}

export enum CompletionItemKind {
	Text = 0,
	Method = 1,
	Function = 2,
	Constructor = 3,
	Field = 4,
	Variable = 5,
	Class = 6,
	Interface = 7,
	Module = 8,
	Property = 9,
	Unit = 10,
	Value = 11,
	Enum = 12,
	Keyword = 13,
	Snippet = 14,
	Color = 15,
	File = 16,
	Reference = 17,
	Folder = 18,
	EnumMember = 19,
	Constant = 20,
	Struct = 21,
	Event = 22,
	Operator = 23,
	TypeParameter = 24,
}

export class CompletionItem {
	public detail?: string;
	public documentation?: any;
	public filterText?: string;
	public sortText?: string;
	public insertText?: any;
	public textEdit?: any;
	public range?: Range;
	constructor(public readonly label: string, public readonly kind?: CompletionItemKind) {}
}

export class TextEdit {
	constructor(public readonly range: Range, public readonly newText: string) {}
	public static replace(range: Range, newText: string): TextEdit {
		return new TextEdit(range, newText);
	}
	public static insert(pos: Position, newText: string): TextEdit {
		return new TextEdit(new Range(pos, pos), newText);
	}
}

export class WorkspaceEdit {
	private edits = new Map<string, TextEdit[]>();
	public replace(uri: Uri, range: Range, newText: string) {
		const list = this.edits.get(uri.toString()) ?? [];
		list.push(TextEdit.replace(range, newText));
		this.edits.set(uri.toString(), list);
	}
	public insert(uri: Uri, pos: Position, newText: string) {
		const list = this.edits.get(uri.toString()) ?? [];
		list.push(TextEdit.insert(pos, newText));
		this.edits.set(uri.toString(), list);
	}
	public getEntries() {
		return this.edits;
	}
}

export enum CodeActionKind {
	QuickFix = 'quickfix',
}

export class CodeAction {
	public edit?: WorkspaceEdit;
	public diagnostics?: Diagnostic[];
	public isPreferred?: boolean;
	constructor(public readonly title: string, public readonly kind?: CodeActionKind) {}
}

export class MarkdownString {
	constructor(public readonly value: string = '') {}
}

export class SnippetString {
	constructor(public readonly value: string = '') {}
}
