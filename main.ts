import {
	App,
	Plugin,
	Modal,
	setIcon,
	getIconIds,
	Notice,
	ItemView,
	Menu,
	PluginSettingTab,
	Setting
} from 'obsidian';

// Интерфейс для Canvas (не экспортируется из Obsidian)
interface CanvasNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	type: string;
	text?: string;
	color?: string;
}

interface Canvas {
	requestSave(): void;
	createTextNode(options: {
		pos: { x: number; y: number };
		size: { width: number; height: number };
		text: string;
		focus?: boolean;
	}): CanvasNode;
	addNode(node: CanvasNode): void;
	getData(): { nodes: CanvasNode[]; edges: any[] };
	setData(data: { nodes: CanvasNode[]; edges: any[] }): void;
	view: ItemView;
	x: number;
	y: number;
	tx: number;
	ty: number;
	tZoom: number;
}

interface CanvasView extends ItemView {
	canvas: Canvas;
}

interface CanvasIconsSettings {
	iconSize: number;
	recentIcons: string[];
	maxRecentIcons: number;
}

const DEFAULT_SETTINGS: CanvasIconsSettings = {
	iconSize: 64,
	recentIcons: [],
	maxRecentIcons: 20
};

// Популярные иконки для быстрого доступа
const POPULAR_ICONS = [
	'star', 'heart', 'check', 'x', 'plus', 'minus',
	'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down',
	'folder', 'file', 'file-text', 'image', 'link',
	'tag', 'bookmark', 'calendar', 'clock', 'bell',
	'user', 'users', 'settings', 'search', 'home',
	'mail', 'message-circle', 'phone', 'map-pin', 'globe',
	'sun', 'moon', 'cloud', 'zap', 'flame',
	'target', 'flag', 'award', 'gift', 'coffee',
	'book', 'pen', 'pencil', 'highlighter', 'eraser',
	'scissors', 'copy', 'clipboard', 'trash', 'archive',
	'download', 'upload', 'share', 'external-link', 'refresh-cw',
	'play', 'pause', 'stop-circle', 'skip-forward', 'skip-back',
	'volume-2', 'mic', 'camera', 'video', 'monitor',
	'smartphone', 'tablet', 'laptop', 'cpu', 'database',
	'code', 'terminal', 'git-branch', 'git-commit', 'git-merge',
	'lock', 'unlock', 'key', 'shield', 'eye',
	'alert-circle', 'info', 'help-circle', 'check-circle', 'x-circle',
	'lightbulb', 'compass', 'map', 'navigation', 'anchor'
];

export default class CanvasIconsPlugin extends Plugin {
	settings: CanvasIconsSettings;
	toolbarButton: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Команда для добавления иконки на Canvas
		this.addCommand({
			id: 'add-icon-to-canvas',
			name: 'Add icon to Canvas',
			checkCallback: (checking: boolean) => {
				const canvasView = this.getActiveCanvasView();
				if (canvasView) {
					if (!checking) {
						this.openIconPicker(canvasView.canvas);
					}
					return true;
				}
				return false;
			}
		});

		// Регистрация события контекстного меню самого Canvas (пустое место)
		this.registerEvent(
			(this.app.workspace as any).on('canvas:selection-menu', (menu: Menu, canvas: Canvas) => {
				menu.addItem((item) => {
					item
						.setTitle('Add icon here')
						.setIcon('plus-circle')
						.onClick(() => {
							this.openIconPicker(canvas);
						});
				});
			})
		);

		// Добавляем пункт в меню при правом клике на canvas
		this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			if (target.closest('.canvas-wrapper')) {
				const canvasView = this.getActiveCanvasView();
				if (canvasView && !target.closest('.canvas-node')) {
					// Добавляем небольшую задержку для ожидания появления меню
					setTimeout(() => {
						const menu = document.querySelector('.menu:not(.canvas-icons-menu-added)');
						if (menu) {
							menu.classList.add('canvas-icons-menu-added');
							const menuItem = menu.createEl('div', { cls: 'menu-item' });
							menuItem.createEl('div', { cls: 'menu-item-icon' });
							setIcon(menuItem.querySelector('.menu-item-icon')!, 'plus-circle');
							menuItem.createEl('div', { cls: 'menu-item-title', text: 'Add icon' });
							menuItem.addEventListener('click', () => {
								const canvas = canvasView.canvas;
								const rect = canvasView.contentEl.getBoundingClientRect();
								const x = (evt.clientX - rect.left - canvas.tx) / canvas.tZoom;
								const y = (evt.clientY - rect.top - canvas.ty) / canvas.tZoom;
								this.openIconPicker(canvas, x, y);
								(menu as HTMLElement).remove();
							});
						}
					}, 10);
				}
			}
		});

		// Добавляем кнопку на панель инструментов Canvas
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.addToolbarButton();
			})
		);
		
		// Также проверяем при открытии файла
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				setTimeout(() => this.addToolbarButton(), 100);
			})
		);

		// Обработчик двойного клика для редактирования иконки
		// Используем capture phase чтобы перехватить событие до Canvas
		const dblClickHandler = (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			const iconContainer = target.closest('.canvas-icon-container');
			if (iconContainer) {
				evt.preventDefault();
				evt.stopPropagation();
				evt.stopImmediatePropagation();
				
				const canvasNode = target.closest('.canvas-node');
				if (canvasNode) {
					const nodeId = canvasNode.getAttribute('data-node-id');
					if (nodeId) {
						const canvasView = this.getActiveCanvasView();
						if (canvasView) {
							this.openIconPickerForEdit(canvasView.canvas, nodeId);
						}
					}
				}
			}
		};
		document.addEventListener('dblclick', dblClickHandler, { capture: true });
		this.register(() => document.removeEventListener('dblclick', dblClickHandler, { capture: true }));

		// Добавляем настройки
		this.addSettingTab(new CanvasIconsSettingTab(this.app, this));
	}

	addToolbarButton() {
		const canvasView = this.getActiveCanvasView();
		if (!canvasView) {
			return;
		}

		// Ищем панель инструментов Canvas
		const toolbar = canvasView.contentEl.querySelector('.canvas-card-menu');
		if (!toolbar) {
			return;
		}

		// Проверяем, не добавлена ли уже кнопка
		if (toolbar.querySelector('.canvas-icons-toolbar-btn')) {
			return;
		}

		// Создаём div с теми же классами и атрибутами как у остальных кнопок
		const button = document.createElement('div');
		button.className = 'canvas-card-menu-button mod-draggable canvas-icons-toolbar-btn';
		button.setAttribute('aria-label', 'Add icon');
		button.setAttribute('data-tooltip-position', 'top');
		setIcon(button, 'smile-plus');
		
		button.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openIconPicker(canvasView.canvas);
		});

		// Добавляем кнопку в тулбар
		toolbar.appendChild(button);
		this.toolbarButton = button;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getActiveCanvasView(): CanvasView | null {
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		if (view && view.getViewType() === 'canvas') {
			return view as CanvasView;
		}
		return null;
	}

	openIconPicker(canvas: Canvas, x?: number, y?: number) {
		new IconPickerModal(this.app, this, canvas, x, y).open();
	}

	openIconPickerForEdit(canvas: Canvas, nodeId: string) {
		// Находим узел в данных Canvas
		const data = canvas.getData();
		const node = data.nodes.find(n => n.id === nodeId);
		if (node && node.text?.includes('canvas-icon-container')) {
			new IconPickerModal(this.app, this, canvas, undefined, undefined, nodeId).open();
		}
	}

	addRecentIcon(iconId: string) {
		// Удаляем иконку если она уже есть
		this.settings.recentIcons = this.settings.recentIcons.filter(id => id !== iconId);
		// Добавляем в начало
		this.settings.recentIcons.unshift(iconId);
		// Ограничиваем количество
		if (this.settings.recentIcons.length > this.settings.maxRecentIcons) {
			this.settings.recentIcons = this.settings.recentIcons.slice(0, this.settings.maxRecentIcons);
		}
		this.saveSettings();
	}
}

class IconPickerModal extends Modal {
	plugin: CanvasIconsPlugin;
	canvas: Canvas;
	x?: number;
	y?: number;
	editNodeId?: string; // ID узла для редактирования
	searchInput: HTMLInputElement;
	iconGrid: HTMLElement;
	allIcons: string[];
	filteredIcons: string[];
	selectedSize: number;

	constructor(app: App, plugin: CanvasIconsPlugin, canvas: Canvas, x?: number, y?: number, editNodeId?: string) {
		super(app);
		this.plugin = plugin;
		this.canvas = canvas;
		this.x = x;
		this.y = y;
		this.editNodeId = editNodeId;
		this.allIcons = getIconIds();
		this.filteredIcons = this.allIcons;
		this.selectedSize = plugin.settings.iconSize;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('canvas-icons-modal');

		// Заголовок (разный для создания и редактирования)
		const title = this.editNodeId ? 'Change icon' : 'Choose an icon';
		contentEl.createEl('h2', { text: title });

		// Контейнер поиска и настроек
		const controlsContainer = contentEl.createDiv({ cls: 'canvas-icons-controls' });

		// Поиск
		const searchContainer = controlsContainer.createDiv({ cls: 'canvas-icons-search' });
		this.searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Search icons...',
			cls: 'canvas-icons-search-input'
		});
		this.searchInput.focus();
		this.searchInput.addEventListener('input', () => this.filterIcons());

		// Настройки размера (только для создания новой иконки)
		if (!this.editNodeId) {
			const settingsContainer = controlsContainer.createDiv({ cls: 'canvas-icons-settings' });
			
			// Размер
			const sizeContainer = settingsContainer.createDiv({ cls: 'canvas-icons-size' });
			sizeContainer.createEl('label', { text: 'Size:' });
			const sizeInput = sizeContainer.createEl('input', {
				type: 'range',
				cls: 'canvas-icons-size-input'
			});
			sizeInput.min = '32';
			sizeInput.max = '256';
			sizeInput.value = String(this.selectedSize);
			const sizeLabel = sizeContainer.createEl('span', { 
				text: `${this.selectedSize}px`,
				cls: 'canvas-icons-size-label'
			});
			sizeInput.addEventListener('input', () => {
				this.selectedSize = parseInt(sizeInput.value);
				sizeLabel.textContent = `${this.selectedSize}px`;
			});

			// Подсказка про цвет
			const colorHint = settingsContainer.createDiv({ cls: 'canvas-icons-color-hint' });
			colorHint.createEl('span', { 
				text: 'Tip: Use Canvas color picker to change icon color',
				cls: 'canvas-icons-hint-text'
			});
		}

		// Недавние иконки
		if (this.plugin.settings.recentIcons.length > 0) {
			const recentSection = contentEl.createDiv({ cls: 'canvas-icons-section' });
			recentSection.createEl('h3', { text: 'Recent' });
			const recentGrid = recentSection.createDiv({ cls: 'canvas-icons-grid canvas-icons-grid-recent' });
			this.plugin.settings.recentIcons.forEach(iconId => {
				this.createIconButton(recentGrid, iconId);
			});
		}

		// Популярные иконки
		const popularSection = contentEl.createDiv({ cls: 'canvas-icons-section' });
		popularSection.createEl('h3', { text: 'Popular' });
		const popularGrid = popularSection.createDiv({ cls: 'canvas-icons-grid canvas-icons-grid-popular' });
		POPULAR_ICONS.forEach(iconId => {
			if (this.allIcons.includes(iconId)) {
				this.createIconButton(popularGrid, iconId);
			}
		});

		// Все иконки
		const allSection = contentEl.createDiv({ cls: 'canvas-icons-section canvas-icons-section-all' });
		allSection.createEl('h3', { text: 'All icons' });
		this.iconGrid = allSection.createDiv({ cls: 'canvas-icons-grid' });
		this.renderIcons();
	}

	createIconButton(container: HTMLElement, iconId: string): HTMLElement {
		const iconBtn = container.createEl('button', {
			cls: 'canvas-icons-icon-btn',
			attr: { 'aria-label': iconId, 'title': iconId }
		});
		const iconWrapper = iconBtn.createDiv({ cls: 'canvas-icons-icon-wrapper' });
		setIcon(iconWrapper, iconId);
		
		iconBtn.addEventListener('click', () => {
			this.insertIcon(iconId);
		});
		
		return iconBtn;
	}

	filterIcons() {
		const query = this.searchInput.value.toLowerCase().trim();
		if (query === '') {
			this.filteredIcons = this.allIcons;
		} else {
			this.filteredIcons = this.allIcons.filter(icon => 
				icon.toLowerCase().includes(query)
			);
		}
		this.renderIcons();
	}

	renderIcons() {
		this.iconGrid.empty();
		
		// Ограничиваем количество отображаемых иконок для производительности
		const maxIcons = 200;
		const iconsToRender = this.filteredIcons.slice(0, maxIcons);
		
		iconsToRender.forEach(iconId => {
			this.createIconButton(this.iconGrid, iconId);
		});

		if (this.filteredIcons.length > maxIcons) {
			this.iconGrid.createEl('div', {
				cls: 'canvas-icons-more',
				text: `...and ${this.filteredIcons.length - maxIcons} more. Use search to find specific icons.`
			});
		}

		if (this.filteredIcons.length === 0) {
			this.iconGrid.createEl('div', {
				cls: 'canvas-icons-empty',
				text: 'No icons found'
			});
		}
	}

	insertIcon(iconId: string) {
		// Получаем SVG элемент иконки
		const tempDiv = document.createElement('div');
		setIcon(tempDiv, iconId);
		const svg = tempDiv.querySelector('svg');
		
		if (!svg) {
			new Notice('Failed to get icon');
			return;
		}

		// Устанавливаем адаптивный размер
		// SVG будет подстраиваться под размер контейнера с сохранением пропорций
		// Используем currentColor для наследования цвета от Canvas
		svg.setAttribute('width', '100%');
		svg.setAttribute('height', '100%');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor'); // Использует цвет Canvas
		svg.style.maxWidth = '100%';
		svg.style.maxHeight = '100%';
		svg.style.objectFit = 'contain';
		
		// Создаём HTML с иконкой - контейнер занимает всё пространство без padding
		const svgString = svg.outerHTML;
		const htmlContent = `<div class="canvas-icon-container" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;box-sizing:border-box;">${svgString}</div>`;

		try {
			const data = this.canvas.getData();
			
			if (this.editNodeId) {
				// Режим редактирования - обновляем существующий узел
				const nodeIndex = data.nodes.findIndex(n => n.id === this.editNodeId);
				if (nodeIndex !== -1) {
					data.nodes[nodeIndex].text = htmlContent;
					this.canvas.setData(data);
					this.canvas.requestSave();
					this.plugin.addRecentIcon(iconId);
					new Notice(`Changed icon to: ${iconId}`);
				} else {
					new Notice('Node not found');
				}
			} else {
				// Режим создания - добавляем новый узел
				let posX = this.x ?? this.canvas.x;
				let posY = this.y ?? this.canvas.y;

				// Если позиция не задана, используем центр видимой области
				if (this.x === undefined || this.y === undefined) {
					const canvasView = this.plugin.getActiveCanvasView();
					if (canvasView) {
						const rect = canvasView.contentEl.getBoundingClientRect();
						posX = (-this.canvas.tx + rect.width / 2) / this.canvas.tZoom - this.selectedSize / 2;
						posY = (-this.canvas.ty + rect.height / 2) / this.canvas.tZoom - this.selectedSize / 2;
					}
				}

				const newNode: CanvasNode = {
					id: this.generateId(),
					type: 'text',
					text: htmlContent,
					x: posX,
					y: posY,
					width: this.selectedSize,
					height: this.selectedSize
					// Не устанавливаем color - используется стандартный Canvas color picker
				};
				data.nodes.push(newNode);
				this.canvas.setData(data);
				this.canvas.requestSave();
				this.plugin.addRecentIcon(iconId);
				new Notice(`Added icon: ${iconId}`);
			}
		} catch (err) {
			console.error('Failed to add/edit icon:', err);
			new Notice('Failed to add/edit icon');
		}

		this.close();
	}

	generateId(): string {
		return Math.random().toString(36).substring(2, 18);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class CanvasIconsSettingTab extends PluginSettingTab {
	plugin: CanvasIconsPlugin;

	constructor(app: App, plugin: CanvasIconsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Canvas Icons Settings' });

		new Setting(containerEl)
			.setName('Default icon size')
			.setDesc('Default size for new icons (in pixels)')
			.addSlider(slider => slider
				.setLimits(32, 256, 8)
				.setValue(this.plugin.settings.iconSize)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.iconSize = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Maximum recent icons')
			.setDesc('How many recent icons to remember')
			.addSlider(slider => slider
				.setLimits(5, 50, 5)
				.setValue(this.plugin.settings.maxRecentIcons)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxRecentIcons = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Clear recent icons')
			.setDesc('Remove all recently used icons from the list')
			.addButton(button => button
				.setButtonText('Clear')
				.onClick(async () => {
					this.plugin.settings.recentIcons = [];
					await this.plugin.saveSettings();
					new Notice('Recent icons cleared');
				}));
	}
}

