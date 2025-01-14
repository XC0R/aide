/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderMarkdownAsPlaintext } from '../../../../base/browser/markdownRenderer.js';
import { IMarkdownString, MarkdownString } from '../../../../base/common/htmlContent.js';
import { AccessibleViewProviderId, AccessibleViewType, IAccessibleViewContentProvider } from '../../../../platform/accessibility/browser/accessibleView.js';
import { IAccessibleViewImplentation } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { IAideAgentWidgetService, IChatWidget, ChatTreeItem } from './aideAgent.js';
import { CONTEXT_IN_CHAT_SESSION } from '../common/aideAgentContextKeys.js';
import { ChatWelcomeMessageModel } from '../common/aideAgentModel.js';
import { isResponseVM } from '../common/aideAgentViewModel.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export class ChatResponseAccessibleView implements IAccessibleViewImplentation {
	readonly priority = 100;
	readonly name = 'panelChat';
	readonly type = AccessibleViewType.View;
	readonly when = CONTEXT_IN_CHAT_SESSION;
	getProvider(accessor: ServicesAccessor) {
		const widgetService = accessor.get(IAideAgentWidgetService);
		const widget = widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}
		const chatInputFocused = widget.hasInputFocus();
		if (chatInputFocused) {
			widget.focusLastMessage();
		}

		const verifiedWidget: IChatWidget = widget;
		const focusedItem = verifiedWidget.getFocus();

		if (!focusedItem) {
			return;
		}

		return new ChatResponseAccessibleProvider(verifiedWidget, focusedItem, chatInputFocused);
	}
}

class ChatResponseAccessibleProvider extends Disposable implements IAccessibleViewContentProvider {
	private _focusedItem: ChatTreeItem;
	constructor(
		private readonly _widget: IChatWidget,
		item: ChatTreeItem,
		private readonly _chatInputFocused: boolean
	) {
		super();
		this._focusedItem = item;
	}

	readonly id = AccessibleViewProviderId.Chat;
	readonly verbositySettingKey = AccessibilityVerbositySettingId.Chat;
	readonly options = { type: AccessibleViewType.View };

	provideContent(): string {
		return this._getContent(this._focusedItem);
	}

	private _getContent(item: ChatTreeItem): string {
		const isWelcome = item instanceof ChatWelcomeMessageModel;
		let responseContent = isResponseVM(item) ? item.response.toString() : '';
		if (isWelcome) {
			const welcomeReplyContents = [];
			for (const content of item.content) {
				if (Array.isArray(content)) {
					welcomeReplyContents.push(...content.map(m => m.message));
				} else {
					welcomeReplyContents.push((content as IMarkdownString).value);
				}
			}
			responseContent = welcomeReplyContents.join('\n');
		}
		if (!responseContent && 'errorDetails' in item && item.errorDetails) {
			responseContent = item.errorDetails.message;
		}
		return renderMarkdownAsPlaintext(new MarkdownString(responseContent), true);
	}

	onClose(): void {
		this._widget.reveal(this._focusedItem);
		if (this._chatInputFocused) {
			this._widget.focusInput();
		} else {
			this._widget.focus(this._focusedItem);
		}
	}

	provideNextContent(): string | undefined {
		const next = this._widget.getSibling(this._focusedItem, 'next');
		if (next) {
			this._focusedItem = next;
			return this._getContent(next);
		}
		return;
	}

	providePreviousContent(): string | undefined {
		const previous = this._widget.getSibling(this._focusedItem, 'previous');
		if (previous) {
			this._focusedItem = previous;
			return this._getContent(previous);
		}
		return;
	}
}

