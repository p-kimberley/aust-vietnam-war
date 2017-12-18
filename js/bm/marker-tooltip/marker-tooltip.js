/**
 * A generic class for displaying popup tooltips against a marker
 * @param {jQuery} element - Element to use to display the tooltip. Rendering is carried out by specialised 'render' method
 * @param {BM.Layer.Marker} parentLayer - Parent layer for which markers are attached
 * @constructor
 */
BM.MarkerTooltip = function(element, parentLayer)
{
	var self = this;
	this.element = element;
	this.parentLayer = parentLayer;
	this.isShowing = false;
	this.currentMarker = null;			// Marker that currently has a tooltip attached
	this.queryDelay = 500;				// Delay in milliseconds until a query is passed to the data service. This prevents spamming of the server.
	this.queryTimer = 0;
	this.hasMouseOver = false;			// Whether the mouse is within the bounds of the tooltip
	this.hideTimeoutHandle = 0;			// Used to cancel the hiding of the tooltip
	this.hideDelay = 1000;				// Amount of time before a tooltip is hidden

	/** @type {ol.Overlay} */
	this.overlay = new ol.Overlay({
		element: this.element[0],
		positioning: 'bottom-center',
		autoPan: false,
		stopEvent: false
	});

	BM.map.addOverlay(this.overlay);

	this.element
		.on('mouseover', function() {
			self.hasMouseOver = true;
			self.show();
		})
		.on('mouseleave', function() {
			self.hasMouseOver = false;
			self.hide();
		});
};

/**
 * Displays the tooltip
 */
BM.MarkerTooltip.prototype.show = function()
{
	if (!this.isShowing)
	{
		this.isShowing = true;
		this.element.stop().fadeIn(200);
	}
	else if(this.hideTimeoutHandle)
	{
		clearTimeout(this.hideTimeoutHandle);
		this.hideTimeoutHandle = 0;
	}
};

/**
 * Hides the tooltip
 * @param {boolean} [skipTimeout] - Whether to hide the tooltip immediately, without the usual delay
 */
BM.MarkerTooltip.prototype.hide = function(skipTimeout)
{
	var self = this;
	if (this.isShowing)
	{
		var hideComplete = function() {
			self.currentMarker = null;
			self.isShowing = false;
		};

		if (skipTimeout)
		{
			clearTimeout(self.hideTimeoutHandle);
			self.element.hide();
			hideComplete();
		}
		else if (!this.hasMouseOver && !this.hideTimeoutHandle)
		{
			this.hideTimeoutHandle = setTimeout(function() {
				self.hideTimeoutHandle = 0;
				self.element.stop().fadeOut(200, function() {
					hideComplete();
				});
			}, self.hideDelay);
		}
	}
};

/**
 * Empty DOM elements and display a loading progress message as data is fetched asynchronously
 * @private
 */
BM.MarkerTooltip.prototype.loading = function() {};

/**
 * Query data from a data source. Will be called automatically once the query timeout has expired.
 * @param featureId
 * @param callback - Invoke the callback once query is completed. The 'render' method will be invoked once this occurs.
 * @protected
 */
BM.MarkerTooltip.prototype.query = function(featureId, callback)
{
	callback();
};

/**
 * Abstract method to query from a dataset and populate the tooltip element DOM
 * @param {ol.Feature} marker - Marker for which the tooltip will be displayed
 * @param {[]} data - Data passed from async request
 * @abstract
 * @protected
 */
BM.MarkerTooltip.prototype.render = function(marker, data) {};

/**
 * Moves the tooltip to the position of the specified marker
 * @param {ol.Feature} feature
 */
BM.MarkerTooltip.prototype.showForMarker = function(feature)
{
	var self = this;

	// If an invalid feature was specified, hide the tooltip
	if (!feature)
	{
		this.hide();
		return;
	}

	if (this.currentMarker !== feature && !this.hasMouseOver)
	{
		this.currentMarker = feature;
		var position = feature.getGeometry().getCoordinates();
		if (position)
		{
			this.overlay.setPosition(position);
			this.loading();

			// Cancel any existing queries if they have not been completed yet
			if (this.queryTimer)
			{
				clearTimeout(this.queryTimer);
				this.queryTimer = 0;
			}

			this.queryTimer = setTimeout(function() {
				var incidentID = self.parentLayer.getMarkerID(feature);
				self.query(incidentID, function(data) {
					self.queryTimer = 0;

					// Check whether the feature key value is the same as the one before the async call.
					// Do not continue if the user has since selected a new marker, as a separate request would have been raised.
					if (self.currentMarker === feature)
						self.render(feature, data);
				});
			}, this.queryDelay);
		}
	}

	this.show();
};

/**
 * Displays the tooltip at a geographic location
 * @param featureId
 * @param {ol.Coordinate} position
 */
BM.MarkerTooltip.prototype.showAtPosition = function(featureId, position)
{
	var self = this;

	this.overlay.setPosition(position);
	this.loading();

	// Cancel any existing queries if they have not been completed yet
	if (this.queryTimer)
	{
		clearTimeout(this.queryTimer);
		this.queryTimer = 0;
	}

	this.queryTimer = setTimeout(function() {
		self.query(featureId, function(data) {
			self.queryTimer = 0;
			self.render(undefined, data);
		});
	}, this.queryDelay);

	this.show();
};

/**
 * @param {string} fieldClass
 * @param value
 * @protected
 */
BM.MarkerTooltip.prototype.setFieldValue = function(fieldClass, value)
{
	var fieldEl = this.element.find('.ol-popup-content').find('.' + fieldClass);

	if (value !== undefined && value !== null && value !== '')
		fieldEl.show().find('td').text(value);
	else
		fieldEl.hide();
};