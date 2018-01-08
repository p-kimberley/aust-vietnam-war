/**
 * Displays an individual L.CircleMarker for each contact
 * @param {string} title
 * @param {number} [zIndex]
 * @constructor
 * @class
 * @extends {BM.Layer.Marker.Incident}
 */
BM.Layer.Marker.Incident.Circles = function(title, zIndex)
{
	var self = this;

	BM.Layer.Marker.Incident.call(this, BM.LayerType.contact.individual, title, zIndex, {
		radiusScale: new BM.LayerOption.Slider('Radius scale', {
			min: 1,
			max: 10,
			defaultValue: 6,
			onChange: function(oldValue, newValue) {
				if (self.olLayer)
					self.olLayer.getSource().changed();
			}
		}),
		radiusField: new BM.LayerOption.Selectmenu('Radius metric', {
			options: this.radiusMetricFields,
			onChange: function(oldValue, newValue) {
				if (self.olLayer)
					self.olLayer.getSource().changed();
			}
		}),
		colourField: new BM.LayerOption.Selectmenu('Colour metric', {
			options: this.colourMetricFields,
			defaultValue: this.colourMetricFields[0],
			onChange: function(oldValue, newValue) {
				if (self.olLayer)
					self.olLayer.getSource().changed();
			}
		})
	});

	/**
	 * Timeline data series
	 * @type {BM.TimelineSeries}
	 */
	this.timelineSeries = new BM.TimelineSeries({
		type : 'column',
		name: 'Incident frequency',
		color: '#c11f1f',
		cursor: 'pointer',
		showInNavigator: true,
		navigatorOptions: {
			lineColor: '#e03838',
			fillColor: 'rgba(193, 31, 31, 0.6)'
		}
	});

	// If the 3d view mode is changed, regenerate the layer. This is to ensure vector markers are rendered in 3d view,
	// while in 2d view, ImageVector is used for efficiency
	$('body')
		.on('bm:map3dmode.changed', function(event) {
			self.destroyAllMarkers();
			self.olLayer = undefined;
			self.createLayer();
		})
		.on('bm:layer.enabled', function(event) {
			if (event.layer === self)
			{
				if (event.enabled)
					self.timelineSeries.add();
				else
					self.timelineSeries.remove();

				BM.Timeline.resetDateRange();
			}
		});
};

BM.Layer.Marker.Incident.Circles.prototype = Object.create(BM.Layer.Marker.Incident.prototype);
BM.Layer.Marker.Incident.Circles.prototype.constructor = BM.Layer.Marker.Incident.Circles;

BM.Layer.Marker.Incident.Circles.prototype.stateChanged = function()
{
	BM.Layer.prototype.stateChanged.call(this);

	if (this.timelineSeries)
		this.timelineSeries.setVisible(this.isChecked());
};

/**
 * Generates a layer of individual circle markers representing contacts, with radius scaled by the chosen metric
 * @param callback
 * @private
 */
BM.Layer.Marker.Incident.Circles.prototype.generate = function(callback)
{
	var self = this;

	BM.Layer.Marker.Incident.prototype.generate.call(this, function() {
		// Update Timeline series data
		var contactCountData = self.getContactCountByDate();
		var dataMinDate = moment(contactCountData[0][0]).startOf('day').utc();
		var dataMaxDate = moment(contactCountData[contactCountData.length - 1][0]).startOf('day').utc();

		self.timelineSeries.add();
		self.timelineSeries.setData(contactCountData);
		BM.Timeline.setDateRange(dataMinDate, dataMaxDate);

		var styleFunction = function(resolution) {
			var props = this.getProperties();
			if (props.selected)
			{
				return self.getMarkerStyle(this, resolution, {
					strokeColor: '#FFFF00',
					strokeWidth: 2
				});
			}
			else if (props.visible)
			{
				if (props.highlightSelected)
				{
					return self.getMarkerStyle(this, resolution, {
						fillColor: '#ffb30f',
						strokeColor: '#ffffff',
						strokeWidth: 2,
						radiusAdjustment: 1
					});
				}
				else if (props.highlighted)
				{
					return self.getMarkerStyle(this, resolution, {
						fillColor: '#ff1f39',
						strokeColor: '#eeeeee',
						strokeWidth: 2,
						radiusAdjustment: 1
					});
				}
				else if (props.dimmed)
				{
					return self.getMarkerStyle(this, resolution, {
						opacity: 0.25
					});
				}
				else
				{
					return self.getMarkerStyle(this, resolution);
				}
			}
			else
			{
				return null;
			}
		};

		// Generate markers from the cached contact data array
		$.each(self.incidentData, function(i, item) {
			var coord = ol.proj.fromLonLat([item.Location.lon, item.Location.lat], 'EPSG:3857');
			var point = new ol.geom.Point(coord);

			point.set('altitudeMode', 'clampToGround');

			var marker = new ol.Feature({
				geometry: point
			});

			var colourValues = {};
			$.each(self.radiusMetricFields, function(i, metricField) {
				var stats = self.metricStats[metricField.value];
				var range = (stats.max - stats.min) || 1;
				marker.set(metricField.value, Math.pow(item[metricField.value], 1/3) / Math.pow(range, 1/3), true);
			});

			$.each(self.colourMetricFields, function(i, metricField) {
				if (metricField.value === '(none)')
				{
					// Default to a constant colour
					colourValues[metricField.value] = chroma(metricField.colourStops[0]);
				}
				else if(metricField.value)
				{
					var stats = self.metricStats[metricField.value];
					var scale = chroma.scale(metricField.colourStops).domain([stats.min, stats.max]);
					colourValues[metricField.value] = scale(item[metricField.value] || 0);
				}
			});

			// Add new properties to the marker to enable dynamic incident popup/tooltip loading
			marker.setProperties({
				visible: true,
				selected: false,
				colourValues: colourValues,
				layer: self
			}, true);

			marker.set(self.markerIdKey, item.ID, true);
			marker.setStyle(styleFunction);
			self.markers.push(marker);
		});

		console.log('Markers generated');
		self.createLayer();

		if (!BM.StateManagement.isMapMovePending())
		{
			self.fitViewToExtent(function ()
			{
				if (callback)
					callback();
			});
		}
		else
		{
			if (callback)
				callback();
		}
	});
};

/**
 * @param {ol.Feature} feature
 * @param {Number} resolution
 * @param {{radiusAdjustment,fillColor,strokeColor,strokeWidth,opacity}} [options]
 * @returns {[ol.style.Style]}
 */
BM.Layer.Marker.Incident.Circles.prototype.getMarkerStyle = function(feature, resolution, options)
{
	if (!feature)
		return null;

	options = options || {};

	var radiusScale = this.layerOptions.radiusScale.getValue();
	var radiusMetric = feature.get(this.layerOptions.radiusField.getValue());
	var fillColour = feature.get('colourValues')[this.layerOptions.colourField.getValue()].alpha(0.6);
	var strokeColour = feature.get('colourValues')[this.layerOptions.colourField.getValue()].darken(1.5);
	var fill, stroke;
	var radiusAdjustment = options.radiusAdjustment ? options.radiusAdjustment : 0;

	if (options.fillColor)
	{
		fill = ol.color.asArray(options.fillColor);
		if (options.opacity !== undefined)
			fill[3] = options.opacity;
	}
	else
	{
		fill = fillColour.css();
	}

	if (options.strokeColor)
	{
		stroke = ol.color.asArray(options.strokeColor);
		if (options.opacity !== undefined)
			stroke[3] = options.opacity;
	}
	else
	{
		stroke = strokeColour.css();
	}

	return [new ol.style.Style({
		geometry: new ol.geom.Circle(feature.getGeometry().getCoordinates(), (radiusMetric * radiusScale + radiusAdjustment + 1) * resolution),
		fill: new ol.style.Fill({
			color: fill
		}),
		stroke: new ol.style.Stroke({
			color: stroke,
			width: options.strokeWidth ? options.strokeWidth : undefined
		})
	})];
};

/**
 * Creates the layer. If 3d mode is enabled, vectors are used. Otherwise, layer is rendered as an ImageVector.
 * @private
 */
BM.Layer.Marker.Incident.Circles.prototype.createLayer = function()
{
	var source = new ol.source.Vector({
		features: this.markers
	});

	// Recalculate extent since markers have changed
	this.extent = source.getExtent();

	if (!this.olLayer)
	{
		if (BM.map3dModeEnabled)
		{
			this.olLayer = new ol.layer.Vector({
				source: source
			});
		}
		else
		{
			this.olLayer = new ol.layer.Vector({
				source: source,
				renderMode: 'image'
			});
		}

		this.olLayer.set('id', this.type);
		BM.map.addLayer(this.olLayer);
	}
	else
	{
		BM.map.renderSync();
	}
};

/**
 * Gets the radius of the specified feature's geometry
 * @param {ol.Feature} feature
 * @returns {number}
 */
BM.Layer.Marker.Incident.Circles.prototype.getMarkerRadius = function(feature)
{
	if (!feature)
		return 0;

	return (feature.get(this.layerOptions.radiusField.getValue()) * this.layerOptions.radiusScale.getValue()) || 0;
};

/**
 * Unbinds events from all markers and destroys them
 */
BM.Layer.Marker.Incident.Circles.prototype.destroyAllMarkers = function()
{
	if (this.olLayer)
	{
		if (this.olLayer.getSource())
		{
			if (BM.map3dModeEnabled)
				this.olLayer.getSource().clear(true);
			else
				this.olLayer.getSource().clear(true);
		}
	}
};