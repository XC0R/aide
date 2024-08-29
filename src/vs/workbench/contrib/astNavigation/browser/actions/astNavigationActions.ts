/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { EditorAction, registerEditorAction, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import * as nls from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { CONTEXT_AST_NAVIGATION_MODE } from 'vs/workbench/contrib/astNavigation/common/astNavigationContextKeys';
import { IASTNavigationService } from 'vs/workbench/contrib/astNavigation/common/astNavigationService';

const AST_NAVIGATION_CATEGORY = nls.localize2('astNavigation', "AST Navigation");

class ToggleASTNavigationMode extends Action2 {
	static readonly ID = 'astNavigation.toggleMode';

	constructor() {
		super({
			id: ToggleASTNavigationMode.ID,
			title: nls.localize2('toggleASTNavigationMode', "Toggle AST Navigation Mode"),
			f1: true,
			category: AST_NAVIGATION_CATEGORY,
			toggled: ContextKeyExpr.equals(CONTEXT_AST_NAVIGATION_MODE.key, true),
			icon: Codicon.symbolKeyword,
			menu: {
				id: MenuId.EditorTitle,
				group: 'navigation',
				order: 0
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyE,
			}
		});
	}

	run(accessor: ServicesAccessor) {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.toggleASTNavigationMode();
	}
}

export class MoveUpAction extends EditorAction {
	static readonly ID = 'editor.action.astNavigationUp';
	constructor() {
		super({
			id: MoveUpAction.ID,
			label: nls.localize('moveUp', "Move Up"),
			alias: 'Move Up',
			precondition: CONTEXT_AST_NAVIGATION_MODE,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyCode.UpArrow,
				weight: KeybindingWeight.WorkbenchContrib + 1
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.moveUp();
	}
}

export class MoveDownAction extends EditorAction {
	static readonly ID = 'editor.action.astNavigationDown';
	constructor() {
		super({
			id: MoveDownAction.ID,
			label: nls.localize('moveDown', "Move Down"),
			alias: 'Move Down',
			precondition: CONTEXT_AST_NAVIGATION_MODE,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyCode.DownArrow,
				weight: KeybindingWeight.WorkbenchContrib + 1
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.moveDown();
	}
}

export class MoveIntoAction extends EditorAction {
	static readonly ID = 'editor.action.astNavigationInto';
	constructor() {
		super({
			id: MoveIntoAction.ID,
			label: nls.localize('moveInto', "Move Into"),
			alias: 'Move Into',
			precondition: CONTEXT_AST_NAVIGATION_MODE,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyCode.RightArrow,
				weight: KeybindingWeight.WorkbenchContrib + 1
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.moveInto();
	}
}

export class MoveOutAction extends EditorAction {
	static readonly ID = 'editor.action.astNavigationOut';
	constructor() {
		super({
			id: MoveOutAction.ID,
			label: nls.localize('moveOut', "Move Out"),
			alias: 'Move Out',
			precondition: CONTEXT_AST_NAVIGATION_MODE,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyCode.LeftArrow,
				weight: KeybindingWeight.WorkbenchContrib + 1
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.moveOut();
	}
}

export function registerASTNavigationActions() {
	registerAction2(ToggleASTNavigationMode);
	registerEditorAction(MoveUpAction);
	registerEditorAction(MoveDownAction);
	registerEditorAction(MoveIntoAction);
	registerEditorAction(MoveOutAction);
}
