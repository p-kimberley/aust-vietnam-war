
/**
 * Abstract class for defining a sidebar panel
 * Sidebar panels contain controls and are tied to a particular sidebar button
 * @param {string} id - Used to serialise/deserialise panel state
 * @param {string} buttonElement
 * @param {string} panelElement
 * @param {boolean} enabled - Whether the panel is initially enabled
 * @constructor
 */
BM.RightSidebarPanel = function(id, buttonElement, panelElement, enabled) {
	var self = this;
	this.id = id;
	this.buttonElement = buttonElement;
	this.panelElement = panelElement;
	this.visible = false;
	this.enabled = enabled;

	var collapsiblePanelSections = $(this.panelElement).find('.panel-section-heading.collapsible');
	collapsiblePanelSections.click(function (event) {
		self.togglePanelHeader(event);
	});

	// If each panel heading is not collapsed by default, start it off expanded
	collapsiblePanelSections.filter('.collapsed').trigger('click');

	if (!enabled)
		$(this.buttonElement).hide();
};

BM.RightSidebarPanel.prototype.togglePanelHeader = function(event)
{
	var panelSection = $(event.target).next('.panel-section');
	if (panelSection)
	{
		if (panelSection.css('display') == 'none') {
			panelSection.velocity('slideDown', { duration: 200 });
		}
		else
		{
			panelSection.velocity('slideUp', { duration: 200 });
		}
	}
};

/**
 * Performs initialisation of the panel. Required where a panel carries out async queries during init.
 * @param [callback]
 * @abstract
 */
BM.RightSidebarPanel.prototype.init = function(callback)
{
	if (callback)
		callback();
};

/**
 * Shows the panel within the sidebar
 * @param {boolean} [skipAnimation]
 */
BM.RightSidebarPanel.prototype.show = function(skipAnimation)
{
	$(this.buttonElement).addClass('active');
	$(this.panelElement)
		.css('position', 'inherit')
		.show({
			effect: 'slide',
			direction: 'right',
			duration: skipAnimation ? 0 : 200
		});

	$('body').trigger(new $.Event('bm:right-sidebar-panel.show', {
		panel: this
	}));
};

/**
 * Hides the panel from the sidebar
 */
BM.RightSidebarPanel.prototype.hide = function()
{
	$(this.buttonElement).removeClass('active');
	$(this.panelElement)
		.css('position', 'absolute')
		.fadeOut(300);

	$('body').trigger(new $.Event('bm:right-sidebar-panel.hide', {
		panel: this
	}));
};

/**
 * Enable or disable the sidebar panel. Disabling it will hide both the panel and its activation button
 * @param {boolean} enabled
 */
BM.RightSidebarPanel.prototype.setEnabled = function(enabled)
{
	if (!this.enabled && enabled)
	{
		this.enabled = true;
		$(this.buttonElement).show();
	}
	else if(this.enabled && !enabled)
	{
		this.enabled = false;
		$(this.buttonElement).hide();
	}
};