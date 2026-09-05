import * as mockVscode from './mockVscode';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (id: string, ...args: any[]) {
	if (id === 'vscode') {
		return mockVscode;
	}
	return origRequire.apply(this, [id, ...args]);
};

// Polyfill suite and test for node test runner if mocha is not loaded
if (typeof (global as any).suite !== 'function') {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const nodeTest = require('node:test');
	(global as any).suite = nodeTest.describe;
	(global as any).test = nodeTest.it;
}

// Now import test suite
require('./extension.test');
