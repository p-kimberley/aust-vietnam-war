// Declare the BattleMap (BM) namespace
var BM = BM || {};

BM.mainContainer = $('#main-container');
BM.mapContainer = $('#map-container');

/** @type {ol.Map} */
BM.map = null;
BM.map3d = null;
BM.map3dFeatureEnabled = false;					// Whether to use 3d features. If TRUE, depends on OL3-Cesium being included.
BM.map3dModeEnabled = false;					// Whether the map is in 3D mode

/** @type {ol.interaction.Select} */
BM.selectInteraction = null;
BM.pointerMoveTimeout = 0;						// Timeout is used to reduce the frequency of 'pointermove' calls. Necessary for FF and IE browsers.
BM.pointerMoveProcessInterval = 0;				// Milliseconds before acting on a 'pointermove' event
BM.pointerMoveEnabled = true;					// Pointermove events are disabled during certain cases, such as when selecting a media upload location

BM.isFullscreen = false;						// Page is fullscreen?

BM.markerClickHandlerFn = null;		            // Replaces popup behaviour with a custom function
BM.documentTitle = document.title;				// Used to restore the window title when pushState or replaceState are called

// Disable Dropzone.js auto-discovery so that media upload queues can be handled appropriately
Dropzone.autoDiscover = false;

// Prevent anchor tags with # as their href from corrupting the browser URL state and preventing legacy browsers from working with HistoryJS
(function ($)
{
	$('a[href="#"]').click(function (e)	{
		e.preventDefault();
	});
})(jQuery);

$(document).ready(function ()
{
	// Scale back performance for non-Chrome browsers
	if (bowser.ie)
		BM.pointerMoveProcessInterval = 500;
	else if(!bowser.chrome)
		BM.pointerMoveProcessInterval = 200;
	else
		BM.pointerMoveProcessInterval = 50;

	// Make CKEditor and other elements editable from a jQueryUI dialog
	$.ui.dialog.prototype._allowInteraction = function (event) {
		return true;
	};

	// Disable caching to prevent browsers like Chrome from stalling where there are many concurrent AJAX requests
	$.ajaxSetup({cache: false});

	// Fancybox does not register in the jQuery scope
	jQuery.fancybox = $.fancybox;

	// Set the default locale
	moment.locale("en-au");

	BM.LoadingProgress.init("Initialising Battle Map", '', true);
	BM.LoadingProgress.show();
	BM.init();
});

BM.init = function ()
{
	// Get the ID and details of the currently logged-in user
	RetrieveWPUserProfileFields(function ()
	{
		// Set Highcharts global options
		Highcharts.setOptions({
			lang: {
				rangeSelectorZoom: 'Date Range',
				thousandsSep: ','
			}
		});

		BM.initMap();

		$(window).on('resize', function () {
			BM.mapResize();
		});

		BM.initMapUI(function ()
		{
			// Bootstrap the AngularJS app, now that all components are loaded. This must be performed prior to state restoration.
			angular.bootstrap($('body'), ['BM.angularApp']);

			BM.StateManagement.onInitialStateLoaded(function () {
				BM.postInit();
			});

			// Respond to changes in state initiated by events such as browser forward/back actions
			History.Adapter.bind(window, 'statechange', function ()
			{
				var newState = History.getState(false);
				BM.StateManagement.popState(newState.data, newState.title, decodeURIComponent(newState.url));
			});

			History.pushState(History.getState());
		});

		BM.initUsernoise();
	});
};

BM.initMapUI = function (callback)
{
	// Apply jQueryUI theming to buttons and disable the default POST action
	$('button')
		.button()
		.click(function (event) {
			event.preventDefault();
		});

	$('#map-toggle-fullscreen').click(function() {
		if (!BM.isFullscreen)
			BM.WindowManager.requestFullscreen();
		else
			BM.WindowManager.exitFullscreen();
	});

	$(document).on('webkitfullscreenchange mozfullscreenchange fullscreenchange', function() {
		BM.isFullscreen = !BM.isFullscreen;
		if (BM.isFullscreen)
		{
			$(this).find('.go-fullscreen').hide();
			$(this).find('.restore').show();
		}
		else
		{
			$(this).find('.restore').hide();
			$(this).find('.go-fullscreen').show();
		}
	});

	BM.initTooltips();
	BM.Media.init();
	BM.Media.enableMediaReelRequery(true);
	BM.Search.init();
	BM.RightSidebar.init(function() {
		if (callback)
			callback();
	});
};

// Called once asynchronous operations (i.e. contact generation) have completed.
// This is called by the .done AJAX function within GenerateLayer_Contacts().
BM.replaceStateTimeoutHandle = 0;
BM.postInit = function ()
{
	BM.map.on('moveend', function ()
	{
		if (BM.replaceStateTimeoutHandle === 0)
		{
			BM.replaceStateTimeoutHandle = setTimeout(function () {
				BM.replaceStateTimeoutHandle = 0;
				BM.StateManagement.replaceState();
			}, 1000);
		}
	});

	// Reveal page elements now that preliminary UI load has been completed
	SetModalBackgroundOpacity(BM.constants.defaultModalBackgroundOpacity);

	$(window).trigger('resize');
	BM.LoadingProgress.hide();

	setTimeout(function() {
		if (!localStorage.getItem('quickStartGuideCompleted')) {
			BM.QuickStartGuide.open();
		}
	}, 2000);
};

BM.mapResize = function (callback)
{
	var mainContainer = BM.mainContainer;
	var map = $('#map');
	var effectCanvases = $('canvas.effects-canvas');
	var timelineCollapsedHeight = BM.Timeline.getCollapsedTimelineHeight();
	var timelineCollapsedTop = mainContainer.height() - timelineCollapsedHeight;
	var rightSidebarContainer = $('#right-sidebar-container');

	var leftContainer = $('#left-container');
	var leftContainerWidth = mainContainer.width() - rightSidebarContainer.outerWidth();
	leftContainer.css({
		top: 0,
		left: 0,
		height: timelineCollapsedTop,
		width: leftContainerWidth
	});

	var leftSidebarContainer = $('#left-sidebar-container');
	var leftSidebarWidth = leftSidebarContainer.outerWidth();
	$('#map-drop-target-overlay').css({
		left: leftSidebarWidth,
		width: leftContainerWidth - leftSidebarWidth,
		height: leftContainer.height()
	});

	$('#media-reel').css({
		maxHeight: leftSidebarContainer.height() - $('#map-main-toolbox').outerHeight() - 43
	});

	map.css({
		paddingLeft: leftSidebarWidth,
		paddingBottom: timelineCollapsedHeight
	});

	effectCanvases.css({
		marginLeft: leftSidebarWidth
	});

	rightSidebarContainer.css('height', timelineCollapsedTop);
	$('#right-sidebar-panels').css('height', timelineCollapsedTop);

	var incidentNoteWindow = $('#incident-note-fullscreen-window-container');
	var incidentNoteBodyContainer = incidentNoteWindow.find('.body-container');
	incidentNoteBodyContainer.css('height', leftContainer.height() - leftContainer.find('.header-block-container').outerHeight());

	var overviewMap = $('.ol-overviewmap');
	overviewMap.css({
		right: rightSidebarContainer.outerWidth() + 10
	});

	$('.ol-scale-line').css({
		right: rightSidebarContainer.outerWidth() + 10 + overviewMap.outerWidth() + 10
	});

	$('#map-watermark, #map-main-toolbox, #map-main-toolbox .toolbox-item-menu').css({
		bottom: timelineCollapsedHeight
	});

	// Force a redraw of the map
	BM.redrawBattleMap();

	// Update the size of the timeline to fit its container
	BM.Timeline.redraw();

	BM.AnalyticsPanel.chartController.reflowSelectedChart();

	if (callback)
		callback();
};

BM.initMap = function ()
{
	var hidpi = (BM.constants.devicePixelRatio > 1 ? '@2x' : '');
	var mapCentre = ol.proj.fromLonLat([BM.options.map.at.lon, BM.options.map.at.lat], 'EPSG:4326');

	BM.map = new ol.Map({
		target: document.getElementById('map'),
		//renderer: 'webgl',
		view: new ol.View({
			center: mapCentre,
			projection: 'EPSG:4326',
			zoom: 5
		}),
		controls: [
			new ol.control.Zoom({
				zoomInLabel: $('<span class="fa fa-plus"></span>')[0],
				zoomOutLabel: $('<span class="fa fa-minus"></span>')[0]
			}),
			new ol.control.ScaleLine(),
			new ol.control.OverviewMap({
				collapsible: false,
				view: new ol.View({
					center: mapCentre,
					projection: 'EPSG:4326'
				}),
				layers: [
					new ol.layer.Tile({
						source: new ol.source.XYZ({
							url: 'https://api.tiles.mapbox.com/v4/kimberleyp.990f49a0/{z}/{x}/{y}' + hidpi + '.png?access_token=pk.eyJ1Ijoia2ltYmVybGV5cCIsImEiOiJDMEhFZ0RjIn0.5nKgLWgVptAO-QCS7Y035w',
							crossOrigin: 'Anonymous',
							tilePixelRatio: BM.constants.devicePixelRatio,
							projection: 'EPSG:3857'
						})
					})
				]
			})
		]
	});

	BM.selectInteraction = new ol.interaction.Select({
		condition: ol.events.condition.singleClick,
		filter: function(feature, layer) {
			if (layer)
				return layer.getProperties().isSelectable === true;
			else
				return false;
		}
	});

	BM.map.addInteraction(BM.selectInteraction);

	BM.selectInteraction.on('select', function(event) {
		if (event.selected.length === 0)
		{
			// If nothing selected, close the right sidebar
			BM.RightSidebar.setVisible(false);

			// Collapse the Timeline and unhighlight any markers
			BM.Timeline.collapseTimeline();
		}
	});

	BM.map.on('pointermove', function(event) {
		if (BM.pointerMoveTimeout)
			clearTimeout(BM.pointerMoveTimeout);

		if (!event.dragging && !event.originalEvent.buttons)
		{
			BM.pointerMoveTimeout = setTimeout(function () {
				BM.pointerMoveTimeout = 0;
				BM.handlePointerMove(event);
			}, BM.pointerMoveProcessInterval);
		}
		else
		{
			$('body').trigger($.Event('bm:marker.blur'));
		}
	});

	BM.map.on('click', function(event) {
		// Close any open flyout menus if the user clicks the map
		BM.MainToolbox.closeActiveFlyouts();
		BM.MainToolbox.closeAllFlyouts();
	});

	if (BM.map3dFeatureEnabled)
	{
		BM.map3d = new olcs.OLCesium({
			map: BM.map
		});

		var scene = BM.map3d.getCesiumScene();
		scene.terrainProvider = new Cesium.CesiumTerrainProvider({
			url: '//assets.agi.com/stk-terrain/world'
		});

		BM.map3d.setEnabled(false);
		//BM.map3d.warmUp(BM.map3d.getCamera().getAltitude(), 50000)
	}
};

/**
 * Calculates map view area edge padding, taking into account the current state of UI components including the Timeline and Right Sidebar
 * @returns {[Number,Number]} - Number of pixels to pad horizontally and vertically
 */
BM.getViewAreaPadding = function()
{
	var padding = [0, 0];

	if (BM.RightSidebar.isVisible())
		padding[0] += BM.RightSidebar.getWidth();

	padding[1] += BM.Timeline.getHeight();

	return padding;
};

/**
 * Fits the map view to the provided extent. Pan and zoom animation is performed, where specified duration(s) are greater than zero
 * @param {ol.Extent} extent
 * @param {Number} duration
 */
BM.fitViewToExtent = function(extent, duration)
{
	if (extent)
	{
		var view = BM.map.getView();
		var basePadding = 20;
		var padding = BM.getViewAreaPadding();

		view.fit(extent, {
			size: BM.map.getSize(),
			padding: [basePadding, basePadding + padding[0], basePadding + padding[1], basePadding],
			duration: duration
		});
	}
};

/**
 * Pans and zooms the camera to the specified location and zoom level
 * @param {ol.Coordinate} location
 * @param {Number} zoomLevel
 * @param {Number} duration
 */
BM.flyTo = function(location, zoomLevel, duration)
{
	if (location && zoomLevel)
	{
		var view = BM.map.getView();
		view.animate({
			center: location,
			zoom: zoomLevel,
			duration: duration
		});
	}
};

/**
 * @param event
 */
BM.handlePointerMove = function(event)
{
	if (event.dragging)
		return;

	var pixel = BM.map.getEventPixel(event.originalEvent);
	var layerFilter = function(hitLayer) {
		if (hitLayer)
			return hitLayer.getProperties().changeCursorOnHover;
		else
			return false;
	};

	var currentCursor = BM.map.getTarget().style.cursor;
	var foundLayer = false, foundFeature = false;
	if (BM.pointerMoveEnabled)
	{
		foundLayer = BM.map.forEachLayerAtPixel(pixel, function (layer) {
			$('body').trigger($.Event('bm:layer.hover', {
				layer: layer,
				screenPosition: pixel
			}));

			return true;
		}, this, layerFilter);

		foundFeature = BM.map.forEachFeatureAtPixel(pixel, function (feature) {
			$('body').trigger($.Event('bm:marker.hover', {
				marker: feature,
				layer: feature.get('layer'),
				screenPosition: pixel
			}));

			return true;
		}, {
			layerFilter: layerFilter
		});
	}

	BM.map.getTarget().style.cursor = foundLayer || foundFeature ? 'pointer' : '';
	if (currentCursor === 'pointer')
	{
		if (!foundLayer)
			$('body').trigger($.Event('bm:layer.blur'));
		if (!foundFeature)
			$('body').trigger($.Event('bm:marker.blur'));
	}
};

BM.redrawBattleMap = function ()
{
	// Force a redraw of the map
	if (BM.map)
		BM.map.updateSize();
};

// Creates tooltips for selected UI elements
BM.initTooltips = function ()
{
	// Layer and note selection panel buttons
	$('#map-layer-button').tooltipster({
		content: $('<span>Customise the map with<br/>map overlays and basemaps</span>'),
		position: 'bottom',
		animation: 'grow'
	});
	$('#map-incident-notes-button').tooltipster({
		content: $('<span>View incident notes<br/>submitted by the community</span>'),
		position: 'bottom',
		animation: 'grow'
	});

	// Layer panel pin
	$('#layer-panel-pin').tooltipster({
		position: 'top'
	});

	// Create a tooltip for the incident media button
	$('div.map-media-button').tooltipster({
		content: "View images and videos relating to the selected incident or point on the map. Upload your own photographs and other media to tell your story.",
		position: 'top'
	});

	// Create a tooltip for the incident panel button
	$('#map-sidebar-show-hide-button').tooltipster({
		content: "Show or hide the incident panel",
		position: 'right'
	});
};

BM.initICheckUIControl = function (controlElement)
{
	if (controlElement)
	{
		controlElement.iCheck({
			checkboxClass: 'icheckbox_square-blue',
			radioClass: 'iradio_square-blue',
			increaseArea: '10%'
		});
	}
};

/**
 * Enables or disables the Cesium 3D map view
 * @param {boolean} [enable]
 */
BM.map3dMode = function (enable)
{
	if (BM.map3dModeEnabled !== enable)
	{
		BM.map3dModeEnabled = enable;
		BM.map3d.setEnabled(enable);

		$('body').trigger($.Event('bm:map3dmode.changed', {
			enabled: enable
		}));
	}
};

/**
 * Populates Usernoise form fields if the user is logged in
 */
BM.initUsernoise = function()
{
	if (BM.currentWPUser.ID > 0)
	{
		usernoise.config.loggedIn = true;
		usernoise.config.form.fields.name = BM.currentWPUser.firstName + ' ' + BM.currentWPUser.lastName;
		usernoise.config.form.fields.email = BM.currentWPUser.email;
		window.usernoiseConfigUrl = ''
	}
};