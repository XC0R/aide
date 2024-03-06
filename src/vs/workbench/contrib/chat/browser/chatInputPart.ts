/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { IHistoryNavigationWidget } from 'vs/base/browser/history';
import { ActionViewItem, IActionViewItemOptions } from 'vs/base/browser/ui/actionbar/actionViewItems';
import * as aria from 'vs/base/browser/ui/aria/aria';
import { IAction } from 'vs/base/common/actions';
import { Codicon } from 'vs/base/common/codicons';
import { Emitter } from 'vs/base/common/event';
import { HistoryNavigator } from 'vs/base/common/history';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { FileAccess } from 'vs/base/common/network';
import { isMacintosh } from 'vs/base/common/platform';
import { ThemeIcon } from 'vs/base/common/themables';
import { URI } from 'vs/base/common/uri';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { EDITOR_FONT_DEFAULTS } from 'vs/editor/common/config/editorOptions';
import { IPosition } from 'vs/editor/common/core/position';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/model';
import { HoverController } from 'vs/editor/contrib/hover/browser/hover';
import { localize } from 'vs/nls';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from 'vs/platform/actions/browser/toolbar';
import { MenuId } from 'vs/platform/actions/common/actions';
import { IAIModelSelectionService } from 'vs/platform/aiModel/common/aiModels';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { registerAndCreateHistoryNavigationContext } from 'vs/platform/history/browser/contextScopedHistoryWidget';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { DEFAULT_FONT_FAMILY } from 'vs/workbench/browser/style';
import { AccessibilityVerbositySettingId } from 'vs/workbench/contrib/accessibility/browser/accessibilityConfiguration';
import { AccessibilityCommandId } from 'vs/workbench/contrib/accessibility/common/accessibilityCommands';
import { ChatSubmitEditorAction, ChatSubmitSecondaryAgentEditorAction } from 'vs/workbench/contrib/chat/browser/actions/chatActions';
import { IChatExecuteActionContext, SubmitAction } from 'vs/workbench/contrib/chat/browser/actions/chatExecuteActions';
import { IChatWidget } from 'vs/workbench/contrib/chat/browser/chat';
import { ChatFollowups } from 'vs/workbench/contrib/chat/browser/chatFollowups';
import { IChatRequester } from 'vs/workbench/contrib/chat/browser/csChat';
import { IChatAgentService } from 'vs/workbench/contrib/chat/common/chatAgents';
import { CONTEXT_CHAT_INPUT_CURSOR_AT_TOP, CONTEXT_CHAT_INPUT_HAS_TEXT, CONTEXT_IN_CHAT_INPUT } from 'vs/workbench/contrib/chat/common/chatContextKeys';
import { chatAgentLeader } from 'vs/workbench/contrib/chat/common/chatParserTypes';
import { IChatFollowup } from 'vs/workbench/contrib/chat/common/chatService';
import { IChatResponseViewModel } from 'vs/workbench/contrib/chat/common/chatViewModel';
import { IChatHistoryEntry, IChatWidgetHistoryService } from 'vs/workbench/contrib/chat/common/chatWidgetHistoryService';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';

const $ = dom.$;

const INPUT_EDITOR_MIN_HEIGHT = 80;
const INPUT_EDITOR_MAX_HEIGHT = 250;

export class ChatInputPart extends Disposable implements IHistoryNavigationWidget {
	static readonly INPUT_SCHEME = 'chatSessionInput';
	private static _counter = 0;

	private _onDidLoadInputState = this._register(new Emitter<any>());
	readonly onDidLoadInputState = this._onDidLoadInputState.event;

	private _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur = this._onDidBlur.event;

	private _onDidAcceptFollowup = this._register(new Emitter<{ followup: IChatFollowup; response: IChatResponseViewModel | undefined }>());
	readonly onDidAcceptFollowup = this._onDidAcceptFollowup.event;

	private inputEditorHeight = 0;
	protected container!: HTMLElement;

	protected followupsContainer!: HTMLElement;
	private followupsDisposables = this._register(new DisposableStore());

	private _inputEditor!: CodeEditorWidget;
	private _inputEditorElement!: HTMLElement;

	protected requesterContainer!: HTMLElement;
	protected modelNameContainer!: HTMLElement;

	private toolbar!: MenuWorkbenchToolBar;

	get inputEditor() {
		return this._inputEditor;
	}

	private history: HistoryNavigator<IChatHistoryEntry>;
	private historyNavigationBackwardsEnablement!: IContextKey<boolean>;
	private historyNavigationForewardsEnablement!: IContextKey<boolean>;
	private onHistoryEntry = false;
	private inHistoryNavigation = false;
	private inputModel: ITextModel | undefined;
	private inputEditorHasText: IContextKey<boolean>;
	private chatCursorAtTop: IContextKey<boolean>;
	private providerId: string | undefined;

	private cachedDimensions: dom.Dimension | undefined;
	private cachedToolbarWidth: number | undefined;

	readonly inputUri = URI.parse(`${ChatInputPart.INPUT_SCHEME}:input-${ChatInputPart._counter++}`);

	constructor(
		// private readonly editorOptions: ChatEditorOptions, // TODO this should be used
		protected readonly options: { renderFollowups: boolean; renderStyle?: 'default' | 'compact' },
		@IChatWidgetHistoryService protected readonly historyService: IChatWidgetHistoryService,
		@IModelService protected readonly modelService: IModelService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IContextKeyService protected readonly contextKeyService: IContextKeyService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IKeybindingService protected readonly keybindingService: IKeybindingService,
		@IAccessibilityService protected readonly accessibilityService: IAccessibilityService,
		@IAIModelSelectionService protected readonly aiModelSelectionService: IAIModelSelectionService
	) {
		super();

		this.inputEditorHasText = CONTEXT_CHAT_INPUT_HAS_TEXT.bindTo(contextKeyService);
		this.chatCursorAtTop = CONTEXT_CHAT_INPUT_CURSOR_AT_TOP.bindTo(contextKeyService);

		this.history = new HistoryNavigator([], 5);
		this._register(this.historyService.onDidClearHistory(() => this.history.clear()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AccessibilityVerbositySettingId.Chat)) {
				this.inputEditor.updateOptions({ ariaLabel: this._getAriaLabel() });
			}
		}));
		this._register(this.aiModelSelectionService.onDidChangeModelSelection(() => {
			this._renderModelName();
		}));
	}

	protected _getAriaLabel(): string {
		const verbose = this.configurationService.getValue<boolean>(AccessibilityVerbositySettingId.Chat);
		if (verbose) {
			const kbLabel = this.keybindingService.lookupKeybinding(AccessibilityCommandId.OpenAccessibilityHelp)?.getLabel();
			return kbLabel ? localize('actions.chat.accessibiltyHelp', "Chat Input,  Type to ask questions or type / for topics, press enter to send out the request. Use {0} for Chat Accessibility Help.", kbLabel) : localize('chatInput.accessibilityHelpNoKb', "Chat Input,  Type code here and press Enter to run. Use the Chat Accessibility Help command for more information.");
		}
		return localize('chatInput', "Chat Input");
	}

	setState(providerId: string, inputValue: string | undefined, requester?: IChatRequester): void {
		this.providerId = providerId;
		const history = this.historyService.getHistory(providerId);
		this.history = new HistoryNavigator(history, 50);

		if (typeof inputValue === 'string') {
			this.setValue(inputValue);
		}

		if (providerId === 'cs-chat') {
			this.container.classList.replace('interactive-input-part', 'cschat-input-part');
			if (!this.requesterContainer) {
				const secondChild = this.container.childNodes[1];
				const header = $('.header');
				this.container.insertBefore(header, secondChild);
				const user = dom.append(header, $('.user'));
				const model = dom.append(header, $('.slow-model'));
				dom.append(user, $('.avatar-container'));
				dom.append(user, $('h3.username'));
				this.requesterContainer = user;
				this.modelNameContainer = model;
				this.modelNameContainer.style.display = 'none';

				this.inputEditor.updateOptions({
					fontFamily: EDITOR_FONT_DEFAULTS.fontFamily,
					cursorWidth: 3,
					acceptSuggestionOnEnter: 'on'
				});
			}

			if (requester) {
				this._renderRequester(requester);
			}
			this._renderModelName();
		}
	}

	get element(): HTMLElement {
		return this.container;
	}

	showPreviousValue(): void {
		this.navigateHistory(true);
	}

	showNextValue(): void {
		this.navigateHistory(false);
	}

	private navigateHistory(previous: boolean): void {
		const historyEntry = (previous ?
			(this.history.previous() ?? this.history.first()) : this.history.next())
			?? { text: '' };

		this.onHistoryEntry = previous || this.history.current() !== null;

		aria.status(historyEntry.text);

		this.inHistoryNavigation = true;
		this.setValue(historyEntry.text);
		this.inHistoryNavigation = false;

		this._onDidLoadInputState.fire(historyEntry.state);
		if (previous) {
			this._inputEditor.setPosition({ lineNumber: 1, column: 1 });
		} else {
			const model = this._inputEditor.getModel();
			if (!model) {
				return;
			}

			this._inputEditor.setPosition(getLastPosition(model));
		}
	}

	setValue(value: string): void {
		this.inputEditor.setValue(value);
		// always leave cursor at the end
		this.inputEditor.setPosition({ lineNumber: 1, column: value.length + 1 });
	}

	focus() {
		this._inputEditor.focus();
	}

	hasFocus(): boolean {
		return this._inputEditor.hasWidgetFocus();
	}

	/**
	 * Reset the input and update history.
	 * @param userQuery If provided, this will be added to the history. Followups and programmatic queries should not be passed.
	 */
	async acceptInput(userQuery?: string, inputState?: any): Promise<void> {
		if (userQuery) {
			this.history.add({ text: userQuery, state: inputState });
		}

		if (this.accessibilityService.isScreenReaderOptimized() && isMacintosh) {
			this._acceptInputForVoiceover();
		} else {
			this._inputEditor.focus();
			this._inputEditor.setValue('');
		}
	}

	private _acceptInputForVoiceover(): void {
		const domNode = this._inputEditor.getDomNode();
		if (!domNode) {
			return;
		}
		// Remove the input editor from the DOM temporarily to prevent VoiceOver
		// from reading the cleared text (the request) to the user.
		this._inputEditorElement.removeChild(domNode);
		this._inputEditor.setValue('');
		this._inputEditorElement.appendChild(domNode);
		this._inputEditor.focus();
	}

	render(container: HTMLElement, initialValue: string, widget: IChatWidget) {
		this.container = dom.append(container, $('.interactive-input-part'));

		this.followupsContainer = dom.append(this.container, $('.interactive-input-followups'));
		const inputAndSideToolbar = dom.append(this.container, $('.interactive-input-and-side-toolbar'));
		const inputContainer = dom.append(inputAndSideToolbar, $('.interactive-input-and-execute-toolbar'));

		const inputScopedContextKeyService = this._register(this.contextKeyService.createScoped(inputContainer));
		CONTEXT_IN_CHAT_INPUT.bindTo(inputScopedContextKeyService).set(true);
		const scopedInstantiationService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, inputScopedContextKeyService]));

		const { historyNavigationBackwardsEnablement, historyNavigationForwardsEnablement } = this._register(registerAndCreateHistoryNavigationContext(inputScopedContextKeyService, this));
		this.historyNavigationBackwardsEnablement = historyNavigationBackwardsEnablement;
		this.historyNavigationForewardsEnablement = historyNavigationForwardsEnablement;

		const options = getSimpleEditorOptions(this.configurationService);
		options.readOnly = false;
		options.ariaLabel = this._getAriaLabel();
		options.fontFamily = DEFAULT_FONT_FAMILY;
		options.fontSize = 13;
		options.lineHeight = 20;
		options.padding = this.options.renderStyle === 'compact' ? { top: 2, bottom: 2 } : { top: 8, bottom: 8 };
		options.cursorWidth = 1;
		options.wrappingStrategy = 'advanced';
		options.bracketPairColorization = { enabled: false };
		options.suggest = {
			showIcons: false,
			showSnippets: false,
			showWords: true,
			showStatusBar: false,
			insertMode: 'replace',
		};
		options.scrollbar = { ...(options.scrollbar ?? {}), vertical: 'hidden' };

		this._inputEditorElement = dom.append(inputContainer, $('.interactive-input-editor'));
		const editorOptions = getSimpleCodeEditorWidgetOptions();
		editorOptions.contributions?.push(...EditorExtensionsRegistry.getSomeEditorContributions([HoverController.ID]));
		this._inputEditor = this._register(scopedInstantiationService.createInstance(CodeEditorWidget, this._inputEditorElement, options, editorOptions));

		this._register(this._inputEditor.onDidChangeModelContent(() => {
			const currentHeight = Math.min(this._inputEditor.getContentHeight(), INPUT_EDITOR_MAX_HEIGHT);
			if (currentHeight !== this.inputEditorHeight) {
				this.inputEditorHeight = currentHeight;
				this._onDidChangeHeight.fire();
			}

			// Only allow history navigation when the input is empty.
			// (If this model change happened as a result of a history navigation, this is canceled out by a call in this.navigateHistory)
			const model = this._inputEditor.getModel();
			const inputHasText = !!model && model.getValueLength() > 0;
			this.inputEditorHasText.set(inputHasText);

			// If the user is typing on a history entry, then reset the onHistoryEntry flag so that history navigation can be disabled
			if (!this.inHistoryNavigation) {
				this.onHistoryEntry = false;
			}

			if (!this.onHistoryEntry) {
				this.historyNavigationForewardsEnablement.set(!inputHasText);
				this.historyNavigationBackwardsEnablement.set(!inputHasText);
			}
		}));
		this._register(this._inputEditor.onDidFocusEditorText(() => {
			this._onDidFocus.fire();
			inputContainer.classList.toggle('focused', true);
		}));
		this._register(this._inputEditor.onDidBlurEditorText(() => {
			inputContainer.classList.toggle('focused', false);

			this._onDidBlur.fire();
		}));
		this._register(this._inputEditor.onDidChangeCursorPosition(e => {
			const model = this._inputEditor.getModel();
			if (!model) {
				return;
			}

			const atTop = e.position.column === 1 && e.position.lineNumber === 1;
			this.chatCursorAtTop.set(atTop);

			if (this.onHistoryEntry) {
				this.historyNavigationBackwardsEnablement.set(atTop);
				this.historyNavigationForewardsEnablement.set(e.position.equals(getLastPosition(model)));
			}
		}));

		this.toolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, inputContainer, MenuId.ChatExecute, {
			menuOptions: {
				shouldForwardArgs: true
			},
			hiddenItemStrategy: HiddenItemStrategy.Ignore, // keep it lean when hiding items and avoid a "..." overflow menu
			actionViewItemProvider: (action, options) => {
				if (action.id === SubmitAction.ID) {
					return this.instantiationService.createInstance(SubmitButtonActionViewItem, { widget } satisfies IChatExecuteActionContext, action, options);
				}

				return undefined;
			}
		}));
		this.toolbar.getElement().classList.add('interactive-execute-toolbar');
		this.toolbar.context = { widget } satisfies IChatExecuteActionContext;
		this._register(this.toolbar.onDidChangeMenuItems(() => {
			if (this.cachedDimensions && typeof this.cachedToolbarWidth === 'number' && this.cachedToolbarWidth !== this.toolbar.getItemsWidth()) {
				this.layout(this.cachedDimensions.height, this.cachedDimensions.width);
			}
		}));

		if (this.options.renderStyle === 'compact') {
			const toolbarSide = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, inputAndSideToolbar, MenuId.ChatInputSide, {
				menuOptions: {
					shouldForwardArgs: true
				}
			}));
			toolbarSide.getElement().classList.add('chat-side-toolbar');
			toolbarSide.context = { widget } satisfies IChatExecuteActionContext;
		}

		this.inputModel = this.modelService.getModel(this.inputUri) || this.modelService.createModel('', null, this.inputUri, true);
		this.inputModel.updateOptions({ bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false } });
		this._inputEditor.setModel(this.inputModel);
		if (initialValue) {
			this.inputModel.setValue(initialValue);
			const lineNumber = this.inputModel.getLineCount();
			this._inputEditor.setPosition({ lineNumber, column: this.inputModel.getLineMaxColumn(lineNumber) });
		}
	}

	async renderFollowups(items: IChatFollowup[] | undefined, response: IChatResponseViewModel | undefined): Promise<void> {
		if (!this.options.renderFollowups) {
			return;
		}
		this.followupsDisposables.clear();
		dom.clearNode(this.followupsContainer);

		if (items && items.length > 0) {
			this.followupsDisposables.add(this.instantiationService.createInstance<typeof ChatFollowups<IChatFollowup>, ChatFollowups<IChatFollowup>>(ChatFollowups, this.followupsContainer, items, undefined, followup => this._onDidAcceptFollowup.fire({ followup, response })));
		}
	}

	layout(height: number, width: number): number {
		this.cachedDimensions = new dom.Dimension(width, height);

		return this._layout(height, width);
	}

	private _layout(height: number, width: number, allowRecurse = true): number {
		const followupsHeight = this.followupsContainer.offsetHeight;
		const requesterHeight = this.requesterContainer?.offsetHeight ?? 0;

		if (this.providerId === 'cs-chat') {
			const inputPartBorder = 0;
			const inputPartHorizontalPadding = 32;
			const inputPartVerticalPadding = 30;
			let inputEditorHeight = Math.min(this._inputEditor.getContentHeight(), height - followupsHeight - requesterHeight - inputPartHorizontalPadding - inputPartBorder, INPUT_EDITOR_MAX_HEIGHT);
			inputEditorHeight = Math.max(inputEditorHeight, INPUT_EDITOR_MIN_HEIGHT);

			const inputEditorBorder = 0;
			const inputPartHeight = followupsHeight + requesterHeight + inputEditorHeight + inputPartVerticalPadding + inputPartBorder + inputEditorBorder;

			const editorBorder = 0;
			const editorPadding = 0;
			const executeToolbarHeight = this.cachedToolbarWidth = this.toolbar.getItemsWidth();
			const sideToolbarHeight = this.options.renderStyle === 'compact' ? 20 : 0;

			const initialEditorScrollWidth = this._inputEditor.getScrollWidth();
			this._inputEditor.layout({ width: width - inputPartHorizontalPadding - editorBorder - editorPadding - sideToolbarHeight, height: inputEditorHeight });

			if (allowRecurse && initialEditorScrollWidth < 10) {
				// This is probably the initial layout. Now that the editor is layed out with its correct width, it should report the correct contentHeight
				return this._layout(height, width, false);
			}

			return inputPartHeight + executeToolbarHeight;
		}

		const inputPartBorder = 1;
		const inputPartHorizontalPadding = 40;
		const inputPartVerticalPadding = 24;
		const inputEditorHeight = Math.min(this._inputEditor.getContentHeight(), height - followupsHeight - inputPartHorizontalPadding - inputPartBorder, INPUT_EDITOR_MAX_HEIGHT);

		const inputEditorBorder = 2;
		const inputPartHeight = followupsHeight + inputEditorHeight + inputPartVerticalPadding + inputPartBorder + inputEditorBorder;

		const editorBorder = 2;
		const editorPadding = 8;
		const executeToolbarWidth = this.cachedToolbarWidth = this.toolbar.getItemsWidth();
		const sideToolbarWidth = this.options.renderStyle === 'compact' ? 20 : 0;

		const initialEditorScrollWidth = this._inputEditor.getScrollWidth();
		this._inputEditor.layout({ width: width - inputPartHorizontalPadding - editorBorder - editorPadding - executeToolbarWidth - sideToolbarWidth, height: inputEditorHeight });

		if (allowRecurse && initialEditorScrollWidth < 10) {
			// This is probably the initial layout. Now that the editor is layed out with its correct width, it should report the correct contentHeight
			return this._layout(height, width, false);
		}

		return inputPartHeight;
	}

	saveState(): void {
		const inputHistory = this.history.getHistory();
		this.historyService.saveHistory(this.providerId!, inputHistory);
	}

	private _renderRequester(requester: IChatRequester): void {
		const username = requester.username || localize('requester', "You");
		this.requesterContainer.querySelector('h3.username')!.textContent = username;

		const avatarContainer = this.requesterContainer.querySelector('.avatar-container')!;
		if (requester.avatarIconUri) {
			const avatarImgIcon = $<HTMLImageElement>('img.icon');
			avatarImgIcon.src = FileAccess.uriToBrowserUri(requester.avatarIconUri).toString(true);
			avatarContainer.replaceChildren($('.avatar', undefined, avatarImgIcon));
		} else {
			const defaultIcon = Codicon.account;
			const avatarIcon = $(ThemeIcon.asCSSSelector(defaultIcon));
			avatarContainer.replaceChildren($('.avatar.codicon-avatar', undefined, avatarIcon));
		}
	}

	private async _renderModelName(): Promise<void> {
		const modelSelectionSettings = await this.aiModelSelectionService.getValidatedModelSelectionSettings();
		const modelName = modelSelectionSettings.models[modelSelectionSettings.slowModel].name;

		if (modelName) {
			this.modelNameContainer.textContent = modelName;
			this.modelNameContainer.style.display = 'block';
		} else {
			this.modelNameContainer.style.display = 'none';
		}
	}
}

class SubmitButtonActionViewItem extends ActionViewItem {
	private readonly _tooltip: string;

	constructor(
		context: unknown,
		action: IAction,
		options: IActionViewItemOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IChatAgentService chatAgentService: IChatAgentService,
	) {
		super(context, action, options);

		const primaryKeybinding = keybindingService.lookupKeybinding(ChatSubmitEditorAction.ID)?.getLabel();
		let tooltip = action.label;
		if (primaryKeybinding) {
			tooltip += ` (${primaryKeybinding})`;
		}

		const secondaryAgent = chatAgentService.getSecondaryAgent();
		if (secondaryAgent) {
			const secondaryKeybinding = keybindingService.lookupKeybinding(ChatSubmitSecondaryAgentEditorAction.ID)?.getLabel();
			if (secondaryKeybinding) {
				tooltip += `\n${chatAgentLeader}${secondaryAgent.id} (${secondaryKeybinding})`;
			}
		}

		this._tooltip = tooltip;
	}

	protected override getTooltip(): string | undefined {
		return this._tooltip;
	}
}

function getLastPosition(model: ITextModel): IPosition {
	return { lineNumber: model.getLineCount(), column: model.getLineLength(model.getLineCount()) + 1 };
}
