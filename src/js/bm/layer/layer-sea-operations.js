/**
 * OpenLayers tile layer class designed to work with raster sources
 * @param {BM.LayerType} type
 * @param {string} title
 * @param {{}} [options] - Layer user customisation options
 * @param {number} [zIndex]
 * @constructor
 * @extends {BM.Layer}
 */
BM.Layer.SeaOperations = function(type, title, options, zIndex)
{
	var self = this;
	BM.Layer.call(this, type, title, zIndex);

	this.options = options;
	this.layerProperties.changeCursorOnHover = true;

	/**
	 * Timeline data series
	 * @type {BM.TimelineSeries}
	 */
	this.timelineSeries = new BM.TimelineSeries({
		type : 'column',
		name: 'Naval gunfire missions',
		color: '#222bff',
		cursor: 'pointer',
		showInNavigator: true,
		navigatorOptions: {
			lineColor: '#5c6fff',
			fillColor: 'rgba(16, 0, 189, 0.6)'
		}
	});

	/**
	 * Instantiate marker tooltip class to enable tooltips to be displayed when hovering
	 * @type {BM.MarkerTooltip}
	 */
	this.markerTooltip = new BM.MarkerTooltip.SeaOperation(this);
	this.currentFeatureId = undefined;

	$('body')
		.on('bm:naval-gunfire-filter.changed', function(event) {
			self.generate();
		})
		.on('bm:timeline.changed', function(event) {
			if (self.isChecked())
				self.generate();
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
		})
		.on('bm:layer.hover', function(event) {
			if (event.layer === self.olLayer)
				self.showTooltip(event.screenPosition);
		})
		.on('bm:layer.blur', function(event) {
			self.hideTooltip();
		});
};

BM.Layer.SeaOperations.prototype = Object.create(BM.Layer.prototype);
BM.Layer.SeaOperations.prototype.constructor = BM.Layer.SeaOperations;

BM.Layer.SeaOperations.prototype.stateChanged = function()
{
	BM.Layer.prototype.stateChanged.call(this);

	if (this.timelineSeries)
		this.timelineSeries.setVisible(this.isChecked());
};

/**
 * @param callback
 * @private
 */
BM.Layer.SeaOperations.prototype.generate = function(callback)
{
	var self = this;
	var layerQuery = BM.FilterPanel.navalGunfireFilterController.toElasticSearchQuery();

	// Calculate min/max values for scaling
	$.ajax({
		url: '/api/es/search/conga',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"query": layerQuery,
			"aggs": {
				"date_hist": {
					"date_histogram": {
						"field": "Start_Date",
						"interval": "day",
						"min_doc_count": 1
					}
				}
			}
		})
	}).done(function(data) {
		var seriesData = [];

		$.each(data.aggregations.date_hist.buckets, function(i, item) {
			seriesData.push([item.key, item.doc_count]);
		});

		self.timelineSeries.add();
		self.timelineSeries.setData(seriesData);
		BM.FilterPanel.navalGunfireFilterController.updateResultCount(data.hits.total);

		// Add the date range query condition (after generating Timeline series, so dataMin/dataMax reflect the entire data range)
		var dateRange = BM.Timeline.getDateRange();
		if (dateRange.min.isValid() && dateRange.max.isValid())
		{
			layerQuery.bool.must.push({
				"range": {
					"Start_Date": {
						"gte": dateRange.min.valueOf(),
						"lte": dateRange.max.valueOf()
					}
				}
			});
		}

		var findEscapable = new RegExp(',', 'g');
		var layerParams = {
			VERSION: '1.1.1',
			STYLES: 'vietnam:naval_fire_mission_point',
			FORMAT: 'image/png8',
			LAYERS: 'vietnam:conga',
			CRS: 'EPSG:3857',
			VIEWPARAMS:
			'q:' + JSON.stringify(layerQuery).replace(findEscapable, '\\,')
		};

		var source;
		if (!self.olLayer)
		{
			source = new ol.source.ImageWMS({
				url: self.options.url,
				ratio: 1,
				crossOrigin: 'anonymous',
				serverType: 'geoserver',
				params: layerParams,
				projection: 'EPSG:3857'
			});

			self.olLayer = new ol.layer.Image({
				visible: false,
				source: source
			});

			BM.map.addLayer(self.olLayer);
		}
		else
		{
			source = self.olLayer.getSource();
			source.updateParams(layerParams);
		}

		if (callback)
			callback();
	});
};

/**
 * Displays
 * @param screenPosition
 */
BM.Layer.SeaOperations.prototype.showTooltip = function(screenPosition)
{
	// Query WMS service for lat/lon of the feature at the mouse position
	var self = this;
	var source = this.olLayer.getSource();
	var coord = BM.map.getCoordinateFromPixel(screenPosition);
	var url = source.getGetFeatureInfoUrl(coord, BM.map.getView().getResolution(), 'EPSG:3857', {
		'INFO_FORMAT': 'application/json'
	});

	$.getJSON(url, function(result) {
		var features = result.features;
		if (features && features.length > 0)
		{
			var feature = features[0];
			var coords = feature.geometry.coordinates;
			var id = feature.properties._id;

			if (self.currentFeatureId !== id)
			{
				self.currentFeatureId = id;
				self.markerTooltip.showAtPosition(id, coords);
			}
		}
	});
};

BM.Layer.SeaOperations.prototype.hideTooltip = function()
{
	this.currentFeatureId = undefined;
	this.markerTooltip.hide();
};