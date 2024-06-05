/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ThemeIcon } from 'vs/base/common/themables';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction2, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize, localize2 } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IsLinuxContext, IsWindowsContext } from 'vs/platform/contextkey/common/contextkeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IQuickInputButton, IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { ViewAction } from 'vs/workbench/browser/parts/views/viewPane';
import { CHAT_VIEW_ID, IAideChatWidgetService, showChatView } from 'vs/workbench/contrib/aideChat/browser/aideChat';
import { IChatEditorOptions } from 'vs/workbench/contrib/aideChat/browser/aideChatEditor';
import { AideChatEditorInput } from 'vs/workbench/contrib/aideChat/browser/aideChatEditorInput';
import { ChatViewPane } from 'vs/workbench/contrib/aideChat/browser/aideChatViewPane';
import { AideChatAgentLocation } from 'vs/workbench/contrib/aideChat/common/aideChatAgents';
import { CONTEXT_CHAT_INPUT_CURSOR_AT_TOP, CONTEXT_CHAT_LOCATION, CONTEXT_IN_CHAT_INPUT, CONTEXT_IN_CHAT_SESSION, CONTEXT_CHAT_ENABLED } from 'vs/workbench/contrib/aideChat/common/aideChatContextKeys';
import { IChatDetail, IAideChatService } from 'vs/workbench/contrib/aideChat/common/aideChatService';
import { IChatRequestViewModel, IChatResponseViewModel, isRequestVM } from 'vs/workbench/contrib/aideChat/common/aideChatViewModel';
import { IAideChatWidgetHistoryService } from 'vs/workbench/contrib/aideChat/common/aideChatWidgetHistoryService';
import { ACTIVE_GROUP, IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';

export interface IChatViewTitleActionContext {
	chatView: ChatViewPane;
}

export function isChatViewTitleActionContext(obj: unknown): obj is IChatViewTitleActionContext {
	return obj instanceof Object && 'chatView' in obj;
}

export const CHAT_CATEGORY = localize2('aideChat.category', 'Aide');
export const CHAT_OPEN_ACTION_ID = 'workbench.action.aideChat.open';

export interface IChatViewOpenOptions {
	/**
	 * The query for quick chat.
	 */
	query: string;
	/**
	 * Whether the query is partial and will await more input from the user.
	 */
	isPartialQuery?: boolean;
	/**
	 * Any previous chat requests and responses that should be shown in the chat view.
	 */
	previousRequests?: IChatViewOpenRequestEntry[];
}

export interface IChatViewOpenRequestEntry {
	request: string;
	response: string;
}

class OpenChatGlobalAction extends Action2 {
	constructor() {
		super({
			id: CHAT_OPEN_ACTION_ID,
			title: localize2('openChat', "Open Chat"),
			icon: Codicon.commentDiscussion,
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyI,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyI
				}
			}
		});
	}

	override async run(accessor: ServicesAccessor, opts?: string | IChatViewOpenOptions): Promise<void> {
		opts = typeof opts === 'string' ? { query: opts } : opts;

		const chatService = accessor.get(IAideChatService);
		const chatWidget = await showChatView(accessor.get(IViewsService));
		if (!chatWidget) {
			return;
		}
		if (opts?.previousRequests?.length && chatWidget.viewModel) {
			for (const { request, response } of opts.previousRequests) {
				chatService.addCompleteRequest(chatWidget.viewModel.sessionId, request, undefined, 0, { message: response });
			}
		}
		if (opts?.query) {
			if (opts.isPartialQuery) {
				chatWidget.setInput(opts.query);
			} else {
				chatWidget.acceptInput(opts.query);
			}
		}

		chatWidget.focusInput();
	}
}

class ChatHistoryAction extends ViewAction<ChatViewPane> {
	constructor() {
		super({
			viewId: CHAT_VIEW_ID,
			id: `workbench.action.aideChat.history`,
			title: localize2('aideChat.history.label', "Show Chats..."),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', CHAT_VIEW_ID),
				group: 'navigation',
				order: -1
			},
			category: CHAT_CATEGORY,
			icon: Codicon.history,
			f1: true,
			precondition: CONTEXT_CHAT_ENABLED
		});
	}

	async runInView(accessor: ServicesAccessor, view: ChatViewPane) {
		const chatService = accessor.get(IAideChatService);
		const quickInputService = accessor.get(IQuickInputService);
		const viewsService = accessor.get(IViewsService);
		const editorService = accessor.get(IEditorService);
		const items = chatService.getHistory();

		const openInEditorButton: IQuickInputButton = {
			iconClass: ThemeIcon.asClassName(Codicon.file),
			tooltip: localize('aideChat.history.editor', "Open in Editor"),
		};
		const deleteButton: IQuickInputButton = {
			iconClass: ThemeIcon.asClassName(Codicon.x),
			tooltip: localize('aideChat.history.delete', "Delete"),
		};

		interface IChatPickerItem extends IQuickPickItem {
			chat: IChatDetail;
		}
		const picks: IChatPickerItem[] = items.map((i): IChatPickerItem => ({
			label: i.title,
			chat: i,
			buttons: [
				openInEditorButton,
				deleteButton
			]
		}));
		const store = new DisposableStore();
		const picker = store.add(quickInputService.createQuickPick<IChatPickerItem>());
		picker.placeholder = localize('aideChat.history.pick', "Switch to chat");
		picker.items = picks;
		store.add(picker.onDidTriggerItemButton(context => {
			if (context.button === openInEditorButton) {
				editorService.openEditor({ resource: AideChatEditorInput.getNewEditorUri(), options: <IChatEditorOptions>{ target: { sessionId: context.item.chat.sessionId }, pinned: true } }, ACTIVE_GROUP);
				picker.hide();
			} else if (context.button === deleteButton) {
				chatService.removeHistoryEntry(context.item.chat.sessionId);
				picker.items = picks.filter(i => i !== context.item);
			}
		}));
		store.add(picker.onDidAccept(async () => {
			try {
				const item = picker.selectedItems[0];
				const sessionId = item.chat.sessionId;
				const view = await viewsService.openView(CHAT_VIEW_ID) as ChatViewPane;
				view.loadSession(sessionId);
			} finally {
				picker.hide();
			}
		}));
		store.add(picker.onDidHide(() => store.dispose()));

		picker.show();
	}
}

class OpenChatEditorAction extends Action2 {
	constructor() {
		super({
			id: `workbench.action.openAideChat`,
			title: localize2('aideChat.open', "Open Editor"),
			f1: true,
			category: CHAT_CATEGORY,
			precondition: CONTEXT_CHAT_ENABLED
		});
	}

	async run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		await editorService.openEditor({ resource: AideChatEditorInput.getNewEditorUri(), options: { pinned: true } satisfies IChatEditorOptions });
	}
}

export function registerChatActions() {
	registerAction2(OpenChatGlobalAction);
	registerAction2(ChatHistoryAction);
	registerAction2(OpenChatEditorAction);

	registerAction2(class ClearChatInputHistoryAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.aideChat.clearInputHistory',
				title: localize2('aideChat.clearHistory.label', "Clear Input History"),
				precondition: CONTEXT_CHAT_ENABLED,
				category: CHAT_CATEGORY,
				f1: true,
			});
		}
		async run(accessor: ServicesAccessor, ...args: any[]) {
			const historyService = accessor.get(IAideChatWidgetHistoryService);
			historyService.clearHistory();
		}
	});

	registerAction2(class ClearChatHistoryAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.aideChat.clearHistory',
				title: localize2('aideChat.clear.label', "Clear All Workspace Chats"),
				precondition: CONTEXT_CHAT_ENABLED,
				category: CHAT_CATEGORY,
				f1: true,
			});
		}
		async run(accessor: ServicesAccessor, ...args: any[]) {
			const chatService = accessor.get(IAideChatService);
			chatService.clearAllHistoryEntries();
		}
	});

	registerAction2(class FocusChatAction extends EditorAction2 {
		constructor() {
			super({
				id: 'aideChat.action.focus',
				title: localize2('actions.aideChat.focus', 'Focus Chat List'),
				precondition: ContextKeyExpr.and(CONTEXT_IN_CHAT_INPUT, CONTEXT_CHAT_LOCATION.isEqualTo(AideChatAgentLocation.Panel)),
				category: CHAT_CATEGORY,
				keybinding: [
					// On mac, require that the cursor is at the top of the input, to avoid stealing cmd+up to move the cursor to the top
					{
						when: CONTEXT_CHAT_INPUT_CURSOR_AT_TOP,
						primary: KeyMod.CtrlCmd | KeyCode.UpArrow,
						weight: KeybindingWeight.EditorContrib,
					},
					// On win/linux, ctrl+up can always focus the chat list
					{
						when: ContextKeyExpr.or(IsWindowsContext, IsLinuxContext),
						primary: KeyMod.CtrlCmd | KeyCode.UpArrow,
						weight: KeybindingWeight.EditorContrib,
					}
				]
			});
		}

		runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor): void | Promise<void> {
			const editorUri = editor.getModel()?.uri;
			if (editorUri) {
				const widgetService = accessor.get(IAideChatWidgetService);
				widgetService.getWidgetByInputUri(editorUri)?.focusLastMessage();
			}
		}
	});

	registerAction2(class FocusChatInputAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.aideChat.focusInput',
				title: localize2('aideChat.focusInput.label', "Focus Chat Input"),
				f1: false,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.DownArrow,
					weight: KeybindingWeight.WorkbenchContrib,
					when: ContextKeyExpr.and(CONTEXT_IN_CHAT_SESSION, CONTEXT_IN_CHAT_INPUT.negate())
				}
			});
		}
		run(accessor: ServicesAccessor, ...args: any[]) {
			const widgetService = accessor.get(IAideChatWidgetService);
			widgetService.lastFocusedWidget?.focusInput();
		}
	});
}

export function stringifyItem(item: IChatRequestViewModel | IChatResponseViewModel, includeName = true): string {
	if (isRequestVM(item)) {
		return (includeName ? `${item.username}: ` : '') + item.messageText;
	} else {
		return (includeName ? `${item.username}: ` : '') + item.response.asString();
	}
}