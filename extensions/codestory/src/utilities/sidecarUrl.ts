/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const SIDECAR_URL = 'http://127.0.0.1:42424';

export const readSideCarURL = (): string => {
	const aideConfiguration = vscode.workspace.getConfiguration('aide');
	const sideCarURL = aideConfiguration.get('sidecarURL');
	if (sideCarURL === undefined) {
		return SIDECAR_URL;
	}
	if (sideCarURL === '') {
		return SIDECAR_URL;
	}
	if (typeof sideCarURL === 'string') {
		return sideCarURL;
	}
	return SIDECAR_URL;
};


export const sidecarUseSelfRun = (): boolean => {
	const aideConfiguration = vscode.workspace.getConfiguration('aide');
	const sideCarUseSelfRun = aideConfiguration.get('sidecarUseSelfRun');
	if (sideCarUseSelfRun === undefined) {
		return false;
	}
	if (typeof sideCarUseSelfRun === 'boolean') {
		return sideCarUseSelfRun;
	}
	return false;
};