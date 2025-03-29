/**
 * Abstract specialisation of the BM.Layer class
 * @param {BM.LayerType} type
 * @param {string} title
 * @param {number} [zIndex],
 * @param {{}} [layerOptions]
 * @constructor
 * @abstract
 * @class
 * @extends {BM.Layer}
 */
BM.Layer.Marker = function(type, title, zIndex, layerOptions)
{
	BM.Layer.call(this, type, title, zIndex, layerOptions);

	var self = this;
	this.markers = new ol.Collection();			// Array of markers used to perform post-generation filtering and manipulation
	this.markerIdKey = 'markerID';				// Key that maps the marker to the underlying datasource

	/** @type {ol.Extent} */
	this.extent = undefined;					// Calculated on layer generation, used to fit view to layer extent

	this.layerProperties.isSelectable = true;			// Are feature in this layer selectable via ol.interaction.Select?
	this.layerProperties.changeCursorOnHover = true;	// Set cursor to 'pointer' when features in this layer are hovered over

	// Explicitly deselect all markers when the first interaction occurs. This is because there is no way to 'trigger' a
	// select interaction during initial state restoration. This fixes two markers being concurrently 'selected'
	// where another marker is clicked after state load.
	this.firstSelectInteraction = true;

	/**
	 * Instantiate marker tooltip class to enable tooltips to be displayed when hovering
	 * @type {BM.MarkerTooltip}
	 * @abstract
	 */
	this.markerTooltip = undefined;

	// When the user is picking a location, dim the layer and disable tooltips
	$('body')
		.on('bm:location.pickstart', function(event) {
			if (self.olLayer)
			{
				BM.pointerMoveEnabled = false;
				self.olLayer.setVisible(false);
			}
		})
		.on('bm:location.pickend', function(event) {
			if (self.olLayer)
			{
				BM.pointerMoveEnabled = true;
				self.olLayer.setVisible(true);
			}
		})
		.on('bm:maximised.start', function(event) {
			self.interactionEnabled = false;
		})
		.on('bm:maximised.end', function(event) {
			self.interactionEnabled = true;
		})
		.on('bm:marker.hover', function(event) {
			if (self.markerTooltip && event.layer === self)
				self.markerTooltip.showForMarker(event.marker);
		})
		.on('bm:marker.blur', function(event) {
			if (self.markerTooltip)
				self.markerTooltip.hide(true);
		});
};

BM.Layer.Marker.prototype = Object.create(BM.Layer.prototype);
BM.Layer.Marker.prototype.constructor = BM.Layer.Marker;

/**
 * Also hide the marker tooltip along with the layer
 */
BM.Layer.Marker.prototype.removeFromMap = function()
{
	BM.Layer.prototype.removeFromMap.call(this);

	if (this.markerTooltip)
		this.markerTooltip.hide(true);
};

/**
 * Called after layer initialisation, to bind a listener to ol.interaction.Select events
 * @private
 */
BM.Layer.Marker.prototype.addSelectInteraction = function()
{
	BM.selectInteraction.un('select', this.handleSelectInteraction, this);
	BM.selectInteraction.on('select', this.handleSelectInteraction, this);
};

/**
 * @param event
 * @private
 */
BM.Layer.Marker.prototype.handleSelectInteraction = function(event)
{
	var self = this;

	// If this is the first time interacting, we need to explicitly deselect any currently selected markers
	if (self.firstSelectInteraction && event.deselected.length === 0)
		self.deselectAllMarkers();

	// Select markers
	$.each(event.selected, function (i, item) {
		if (item.get('layer') === self)
			self.selectMarker(item);
	});

	// Deselect markers
	$.each(event.deselected, function (i, item)	{
		if (item.get('layer') === self)
			self.deselectMarker(item);
	});
};

/**
 * Ensures that existing markers are destroyed first
 * @param [callback]
 * @param {boolean} [closeLoadingIndicatorWhenDone] - If this layer is being regenerated along with all other layers, do not close the indicator between each layer regeneration
 */
BM.Layer.Marker.prototype.regenerate = function(callback, closeLoadingIndicatorWhenDone)
{
	var self = this;
	this.destroyAllMarkers();
	BM.Layer.prototype.regenerate.call(this, function() {
		self.addSelectInteraction();
		if (callback)
			callback();
	}, closeLoadingIndicatorWhenDone);
};

BM.Layer.Marker.prototype.generate = function() {};

/**
 * Unbinds events from all markers and destroys them
 */
BM.Layer.Marker.prototype.destroyAllMarkers = function()
{
	if (this.olLayer)
		this.olLayer.getSource().clear(true);
};

/**
 * Computes the radius for the given marker based on a particular data field
 * @param {ol.Feature} marker
 * @returns {number}
 */
BM.Layer.Marker.prototype.getMarkerRadius = function(marker)
{
	return 0;
};

/**
 * Returns the layer extent, calculated at generation time
 * @returns {ol.Extent}
 */
BM.Layer.Marker.prototype.getExtent = function()
{
	return this.extent;
};

/**
 * Retrieves a marker object based on its related data ID value
 * @param {number} markerDataId
 * @returns {ol.Feature}
 */
BM.Layer.Marker.prototype.getMarkerByID = function(markerDataId)
{
	var self = this;
	var marker = null;

	this.markers.forEach(function(item) {
		if (item.get(self.markerIdKey) == markerDataId)
		{
			marker = item;
			return false;
		}
	});

	return marker;
};

/**
 * Pan and zoom the map so all markers fit inside the view
 * @param [callback]
 */
BM.Layer.Marker.prototype.fitViewToExtent = function(callback)
{
	BM.fitViewToExtent(this.getExtent(), 1000);

	if (callback)
		return callback();
};

/**
 * Returns a subset of the markers array for bulk adding/removing from the map
 * @param {number} start
 * @param {number} end
 * @returns {Array}
 */
BM.Layer.Marker.prototype.getMarkerSubset = function(start, end)
{
	return this.markers.slice(start, end);
};

/**
 * Default implementation, which adds a marker
 * @param marker
 */
BM.Layer.Marker.prototype.addMarker = function(marker)
{
	if (this.olLayer)
		this.olLayer.getSource().addFeature(marker);
};

/**
 * Default implementation to add an array of markers
 * @param {[]} markers
 */
BM.Layer.Marker.prototype.addMarkers = function(markers)
{
	if (this.olLayer)
		this.olLayer.getSource().addFeatures(markers);
};

/**
 * Default implementation, which removes a marker from the layer
 * @param marker
 */
BM.Layer.Marker.prototype.removeMarker = function(marker)
{
	if (this.olLayer)
		this.olLayer.getSource().removeFeature(marker);
};

/**
 * Retrieves a marker by its array index
 * @param {number} index
 * @returns {*}
 */
BM.Layer.Marker.prototype.getMarkerByIndex = function(index)
{
	if (index < this.markers.getLength())
	{
		return this.markers.item(index);
	}
	else
	{
		console.log('Error: Index provided to getMarkerByIndex is out of bounds');
		return null;
	}
};

/**
 * Hides all markers from view by setting the 'visible' property
 */
BM.Layer.Marker.prototype.hideAllMarkers = function()
{
	if (this.olLayer)
	{
		this.markers.forEach(function (marker) {
			marker.setProperties({visible: false});
		});
	}
};

BM.Layer.Marker.prototype.centreOnMarkerByID = function(id, callback)
{
	var marker = this.getMarkerByID(id);
	this.centreOnMarker(marker, callback);
};

/**
 * Zooms so the specified marker is visible on the map
 * @param marker
 * @param [callback]
 */
BM.Layer.Marker.prototype.centreOnMarker = function(marker, callback)
{
	if (marker)
	{
		var view = BM.map.getView();
		var viewCentre = BM.map.getPixelFromCoordinate(view.getCenter());

		// Subtract the right sidebar width from the centre point, so the marker becomes truly centred
		viewCentre[0] = viewCentre[0] - BM.RightSidebar.getWidth() / 2;
		if (viewCentre[0] < 0)
			viewCentre[0] = 0;

		// Centre the view on the marker's position
		view.setCenter(viewCentre);
	}

	if (callback)
		callback();
};

/**
 * Gets an array containing all the currently selected markers
 * @returns {Array}
 */
BM.Layer.Marker.prototype.getSelectedMarkers = function()
{
	var selected = [];
	this.markers.forEach(function(marker, i) {
		if (marker.get('selected'))
			selected.push(marker);
	});

	return selected;
};

/**
 * Selects the first marker with a matching data ID
 * @param {number} id
 */
BM.Layer.Marker.prototype.selectMarkerByID = function(id)
{
	this.selectMarker(this.getMarkerByID(id));
};

/**
 * Marks an individual marker as selected
 * @param {ol.Feature} marker
 */
BM.Layer.Marker.prototype.selectMarker = function(marker)
{
	if (BM.StateManagement.initialStateLoaded())
		this.firstSelectInteraction = false;

	if (marker)
	{
		if (!marker.get('selected'))
		{
			marker.set('selected', true);
			this.triggerMarkerSelected(marker);
		}
	}
};

/**
 * Triggers a selection event notifying that the marker has been selected
 * @param {ol.Feature} marker
 * @private
 */
BM.Layer.Marker.prototype.triggerMarkerSelected = function(marker)
{
	$('body').trigger($.Event('bm:marker.selected', {
		feature: marker,
		markerID: marker.get(this.markerIdKey),
		layer: this
	}));
};

/**
 * Retrieves the ID of a given marker. This depends on the ID key defined the the class.
 * @param {ol.Feature} marker
 */
BM.Layer.Marker.prototype.getMarkerID = function(marker)
{
	if (marker)
		return marker.get(this.markerIdKey);
};

/**
 * Deselects an individual marker
 * @param {ol.Feature} marker
 */
BM.Layer.Marker.prototype.deselectMarker = function(marker)
{
	this.firstSelectInteraction = false;

	if (marker.get('selected') === true)
	{
		marker.set('selected', false);
		if (this.markerTooltip)
			this.markerTooltip.hide(true);

		this.triggerMarkerDeselected(marker);
	}
};

/**
 * Triggers a selection event notifying that the marker has been deselected
 * @param {ol.Feature} marker
 * @private
 */
BM.Layer.Marker.prototype.triggerMarkerDeselected = function(marker)
{
	$('body').trigger($.Event('bm:marker.deselected', {
		feature: marker,
		markerID: marker.get(this.markerIdKey),
		layer: this
	}));
};

/**
 * Deselects all incident markers
 */
BM.Layer.Marker.prototype.deselectAllMarkers = function()
{
	var self = this;
	this.markers.forEach(function(marker)
	{
		if (marker.get('selected'))
			self.deselectMarker(marker);
	});
};