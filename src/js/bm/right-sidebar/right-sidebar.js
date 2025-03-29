/** @type {BM.RightSidebarPanel.Layers} */
BM.LayerPanel = new BM.RightSidebarPanel.Layers();
/** @type {BM.RightSidebarPanel.Filters} */
BM.FilterPanel = new BM.RightSidebarPanel.Filters();
/** @type {BM.RightSidebarPanel.Analytics} */
BM.AnalyticsPanel = new BM.RightSidebarPanel.Analytics();
/** @type {BM.RightSidebarPanel.Marker} */
BM.MarkerPanel = new BM.RightSidebarPanel.Marker();
/** @type {BM.RightSidebarPanel.Notes} */
BM.NotePanel = new BM.RightSidebarPanel.Notes();
/** @type {BM.RightSidebarPanel.HonourRoll} */
BM.HonourRollPanel = new BM.RightSidebarPanel.HonourRoll();
/** @type {BM.RightSidebarPanel.MediaModeration} */
BM.MediaModerationPanel = new BM.RightSidebarPanel.MediaModeration();

BM.RightSidebar = (function ()
{
	var _isVisible = false;
	var _container = $('#right-sidebar-container');
	var _sidebar = $('#right-sidebar');
	var _sidebarWidth = _sidebar.width();		// Stores the width of the sidebar, including any adjustments the user has made
	var _panels = [];
	var _currentPanel = null;

	/**
	 * @param [callback]
	 * @private
	 */
	function _init(callback)
	{
		_sidebar.resizable({
			handles: 'w',
			resize: function(event, ui) {
				_sidebarWidth = _sidebar.outerWidth();
				$('body').trigger($.Event('bm:rightsidebar.resize'));
			}
		});

		_setVisible(false);

		$('div.sidebar-close-button').click(function () {
			_setVisible(false);
		});

		$('#right-sidebar-panels').mCustomScrollbar({
			autoHideScrollbar: true,
			scrollInertia: 200,
			mouseWheel: {
				scrollAmount: 100
			},
			theme: 'minimal-dark',
			advanced: {
				updateOnContentResize: true
			}
		});

		// Hide panels initially
		_sidebar.find('div.right-sidebar-panel').hide();

		// Set up tooltips for the panel buttons
		_container.find('div.right-sidebar-button').tooltipster({
			side: 'left',
			distance: 0,
			hideOnClick: true
		});

		// Group sidebar button tooltips together so the user can roll over each one without waiting for tooltip show/hide delay
		$.tooltipster.group('right-sidebar-button');

		_sidebar.find('div.sidebar-close-button').tooltipster({
			content: 'Close the Sidebar',
			side: 'left',
			hideOnClick: true
		});

		// Initialise and register panels with the sidebar
		_addPanel(BM.LayerPanel);
		_addPanel(BM.FilterPanel, function() {
			_addPanel(BM.AnalyticsPanel);
			_addPanel(BM.MarkerPanel);
			_addPanel(BM.NotePanel);
			_addPanel(BM.HonourRollPanel);
			_addPanel(BM.MediaModerationPanel);

			if (callback)
				callback();
		});
	}

	/**
	 * Adds a panel and binds events to enable user interaction
	 * @param {BM.RightSidebarPanel} panel
	 * @param [callback]
	 * @private
	 */
	function _addPanel(panel, callback)
	{
		if (panel)
		{
			_panels.push(panel);

			$(panel.buttonElement).click(function() {
				// If the panel is the same as the currently open panel, close the sidebar
				if (panel === _currentPanel)
					_setVisible(false);
				else
					_showPanel(panel);
			});

			panel.init(function() {
				if (callback)
					callback();
			});
		}
	}

	/**
	 * Close the current panel if open and show the specified panel
	 * @param {BM.RightSidebarPanel} panel
	 * @param [callback]
	 * @private
	 */
	function _showPanel(panel, callback)
	{
		var alreadyVisible = _isVisible;

		var showSelectedPanel = function() {
			if (panel !== _currentPanel)
			{
				if (_currentPanel)
					_hidePanel(_currentPanel);

				_currentPanel = panel;
				_currentPanel.show(!alreadyVisible);	// Skip animating the panel if the sidebar was initially hidden
			}
		};

		// If the sidebar is not visible, show it
		if (!alreadyVisible)
		{
			_setVisible(true, function () {
				if (callback)
					callback();
			});

			showSelectedPanel();
		}
		else
		{
			showSelectedPanel();
			if (callback)
				callback();
		}
	}

	/**
	 * Closes the panel
	 * @param {BM.RightSidebarPanel} panel
	 * @private
	 */
	function _hidePanel(panel)
	{
		if (panel)
		{
			panel.hide();
			_currentPanel = null;
		}
	}

	/**
	 * Shows or hides the sidebar
	 * @param {boolean} visible
	 * @param [callback]
	 * @private
	 */
	function _setVisible(visible, callback)
	{
		// If trying to open/close the sidebar while it is already in that state, do nothing
		if (visible && _isVisible === visible)
		{
			if (callback)
				return callback();
		}

		_isVisible = visible;

		var map = $('#map');
		var overviewMap = map.find('.ol-overviewmap');
		var scaleLine = map.find('.ol-scale-line');
		var leftContainer = $('#left-container');
		var sidebarButtonWidth = $('#right-sidebar-buttons').outerWidth() + 3;
		var mainContainerWidth = $('#main-container').width();

		var sidebarWidth = _isVisible ? _sidebarWidth : 0;

		if (_isVisible)
		{
			_sidebar.resizable('enable');
			_container.addClass('active');
		}
		else
		{
			_sidebar.resizable('disable');
			_container.removeClass('active');
			_hidePanel(_currentPanel);
		}

		overviewMap.velocity({
			right: sidebarButtonWidth + sidebarWidth + 10
		}, { duration: 200 });

		scaleLine.velocity({
			right: sidebarButtonWidth + sidebarWidth + overviewMap.outerWidth() + 20
		}, { duration: 200 });

		var leftContainerNewWidth = mainContainerWidth - sidebarButtonWidth - sidebarWidth;
		leftContainer.velocity({
			width: leftContainerNewWidth
		}, { duration: 200 });

		$('#map-drop-target-overlay').velocity({
			width: leftContainerNewWidth - $('#left-sidebar-container').outerWidth()
		}, { duration: 200 });

		_sidebar.velocity({
			width: sidebarWidth,
			minWidth: _isVisible ? 300 : 0,
			borderWidth: _isVisible ? 'inherit' : 0,
			opacity: 1
		}, {
			duration: 200,
			progress: function() {
				BM.AnalyticsPanel.chartController.reflowSelectedChart();
			},
			complete: function() {
				if (callback)
					callback();
			}
		});

		$('body').trigger(new $.Event('bm:right-sidebar.visibilityChanged', {
			visible: _isVisible
		}));
	}

	/**
	 * Gets the normal (opened) width of the sidebar
	 * @returns {number}
	 * @private
	 */
	function _getWidth()
	{
		return _sidebarWidth;
	}

	return {
		init: _init,
		isVisible: function() { return _isVisible; },
		setVisible: _setVisible,
		showPanel: _showPanel,
		hidePanel: _hidePanel,
		getWidth: _getWidth
	};
})();