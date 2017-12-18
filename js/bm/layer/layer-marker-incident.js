/**
 * Displays markers based on shared incident data
 * @param {BM.LayerType} type
 * @param {string} title
 * @param {number} [zIndex]
 * @param {{}} [layerOptions]
 * @constructor
 * @class
 * @extends {BM.Layer.Marker}
 */
BM.Layer.Marker.Incident = function(type, title, zIndex, layerOptions)
{
	var self = this;
	BM.Layer.Marker.call(this, type, title, zIndex, layerOptions);

	this.incidentData = [];										// Local copy of contact database results, used to generate contact markers
	this.incidentDataDateIndex = [];							// Speeds up accessing incidentData elements by date
	this.incidentDataIdIndex = [];
	this.incidentDataDateCounts = [];							// Used to populate Timeline series
	this.metricStats = {};										// Contains statistics on each metric registered in metricFields

	this.layerProperties.isIncident = true;						// Identify this as an incident marker, for use during select interactions
	this.markerTooltip = new BM.MarkerTooltip.Incident(this);
	this.lastHighlightedMarkers = [];							// The last markers to be highlighted. Used to unhighlight markers, due to Highcharts not firing 'mouseout' events reliably
	this.lastHighlightSelectedMarkers = [];

	$('body')
		.on('bm:contact-filter.changed', function(event) {
			self.regenerate();
		})
		.on('bm:incidentmarker.selected', function(event) {
			var marker = event.feature;
			var incidentID = marker.get(self.markerIdKey);

			BM.ActivityLogging.logEvent(BM.LogEventTypes.openedIncidentFromMap, incidentID);
			BM.MarkerPanel.showForIncident(marker);
		})
		.on('bm:incidentmarker.deselected', function(event) {
			var selectedMarkers = BM.selectInteraction.getFeatures().getArray();
			var incidentMarker = null;
			$.each(selectedMarkers, function(i, item) {
				var layer = item.get('layer');
				if (layer)
				{
					if (item.get('layer').olLayer.getProperties().isIncident)
						incidentMarker = item;
				}
			});

			if (!incidentMarker)
			{
				// No incident markers selected, so close the marker sidebar panel
				BM.RightSidebar.setVisible(false, function () {
					BM.MarkerPanel.deselectIncident();
				});
			}
		})
		.on('bm:timeline.changed', function(event) {
			self.filterMarkers(event.oldMin, event.oldMax, event.newMin, event.newMax, true);
		})
		.on('bm:timeline.daterange-hover', function(event) {
			self.highlightMarkersByDate(event.startDate, event.endDate, true);
		})
		.on('bm:timeline.daterange-blur', function(event) {
			self.unhighlightMarkers();
		})
		.on('bm:timeline.daterange-selected', function(event) {
			self.highlightSelectMarkersByDate(event.startDate, event.endDate, true);
		})
		.on('bm:timeline.daterange-deselected', function(event) {
			self.highlightSelectMarkersByDate(event.startDate, event.endDate, false);
		});
};

BM.Layer.Marker.Incident.prototype = Object.create(BM.Layer.Marker.prototype);
BM.Layer.Marker.Incident.prototype.constructor = BM.Layer.Marker.Incident;

BM.Layer.Marker.Incident.prototype.radiusMetricFields = [
	{ name: 'Size of friendly force', value: 'Fr_Force_Present' },
	{ name: 'Friendly casualties', value: 'Total_Fr_Cas', selected: true },
	{ name: 'Size of enemy force', value: 'En_Force' },
	{ name: 'Enemy casualties', value: 'Total_En_Cas' }
];

BM.Layer.Marker.Incident.prototype.colourMetricFields = [
	{ name: '(none)', value: '(none)', colourStops: ['red'] },
	{ name: 'Hour of day', value: 'Hour', colourStops: ['black', 'yellow', 'black'] },
	{ name: 'Date', value: 'DTG', colourStops: ['black', 'red'] },
	{ name: 'Mine incident', value: 'Mine_Incid', colourStops: ['red', 'black'] },
	{ name: 'Friendly fire', value: 'Friendly_Fire', colourStops: ['black', 'red'] }
];

/**
 * Should be called by overrides
 * @param [callback]
 * @protected
 */
BM.Layer.Marker.Incident.prototype.generate = function(callback)
{
	// Update the number of incidents in the filter panel
	this.retrieveContactData(function() {
		if (callback)
			callback();
	});
};

/**
 * Queries the data service for contact data. Caches this locally for use by the specific types of contact marker: clustered and individual.
 * Called on initial load or when filters are changed.
 * @param [callback]
 * @protected
 */
BM.Layer.Marker.Incident.prototype.retrieveContactData = function(callback)
{
	var self = this;
	var currentIncident = 0;
	var dateMin = undefined;
	var query = BM.FilterPanel.contactFilterController.toElasticSearchQuery();

	query.bool.must.push({
		"range": {
			"Location.lat": {
				"gt": null
			}
		}
	});

	query.bool.must.push({
		"range": {
			"Location.lon": {
				"gt": null
			}
		}
	});

	this.incidentData = [];
	this.incidentDataDateIndex = [];
	this.incidentDataIdIndex = [];
	this.incidentDataDateCounts = [];

	BM.LoadingProgress.setStatusMessage('Retrieving contact data');

	var sourceFields = ['Location', 'DTG', 'Incident_Notes'];
	var aggs = {
		"incidents": {
			"date_histogram": {
				"field": "DTG",
				"interval": "day",
				"min_doc_count": 1
			}
		}
	};

	$.each(this.radiusMetricFields, function(i, metric) {
		var fieldName = metric.value;
		sourceFields.push(fieldName);
		aggs[fieldName] = {
			"stats": {
				"field": fieldName
			}
		}
	});

	$.each(this.colourMetricFields, function(i, metric) {
		var fieldName = metric.value;

		if (metric.value)
		{
			sourceFields.push(fieldName);
			aggs[fieldName] = {
				"stats": {
					"field": fieldName
				}
			}
		}
	});

	$.ajax({
		url: '/api/es/search/avw_contacts/contact?scroll=30s',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 1000,
			"_source": sourceFields,
			"sort": [{
				"DTG": {
					"order": "asc"
				}
			}],
			"query": query,
			"aggs": aggs
		})
	}).then(function processResults(response) {
		console.log('Processing contact data');

		// Populate Timeline series data using date histogram aggregate query
		if (response.aggregations)
		{
			self.metricStats = response.aggregations;

			$.each(response.aggregations.incidents.buckets, function (i, item) {
				self.incidentDataDateCounts.push([item.key, item.doc_count]);
			});
		}

		$.each(response.hits.hits, function (i, item)
		{
			var fields = item._source;

			fields.ID = parseInt(item._id);
			fields.DTG = moment.utc(fields.DTG, 'YYYY-MM-DD');

			self.incidentData.push(fields);
			self.incidentDataIdIndex[fields.ID] = currentIncident;

			if (currentIncident === 0)
				dateMin = fields.DTG;

			var dateOffset = Math.abs(dateMin.diff(fields.DTG, 'days'));
			var currentIndex = self.incidentDataDateIndex[dateOffset];
			if (currentIndex)
				currentIndex.push(currentIncident);
			else
				self.incidentDataDateIndex[dateOffset] = [currentIncident];

			currentIncident++;
		});

		// If there are more records remaining, send another request to retrieve them
		if (response.hits.total !== currentIncident)
		{
			$.ajax({
				url: "/api/es/scroll",
				method: "POST",
				dataType: 'json',
				contentType: 'application/json',
				data: JSON.stringify({
					"scroll": '30s',
					"scroll_id": response._scroll_id
				})
			}).then(function(response) {
				processResults(response);
			});
		}
		else
		{
			console.log('Contact data processing completed');
			BM.FilterPanel.contactFilterController.updateResultCount(self.incidentData.length);
			if (callback)
				return callback();
		}
	}).fail(function (error)
	{
		$('#filter-results-count').html("");
		InfoDialog("Error", "There was an error generating incident markers.<br/><br/>Please check your Internet connection and refresh the page.<br/><br/>" +
			"Technical data: " + error.message);
	});
};

/**
 * Returns the number of days from the earliest incident date, to the provided date
 * @param {moment} date
 * @returns {Number}
 * @protected
 */
BM.Layer.Marker.Incident.prototype.getDateOffset = function(date)
{
	if (this.incidentData.length > 0)
	{
		var startDate = this.incidentData[0].DTG;
		if (date)
		{
			// If the date occurred before the data start date, adjust it to 0, so date span operations can succeed
			var diff = date.diff(startDate, 'days');
			return diff >= 0 ? diff : 0;
		}
		else
		{
			return 0;
		}
	}
};

/**
 * Retrieves the incident data item by its ID
 * @param {Number} id
 * @returns {*}
 * @protected
 */
BM.Layer.Marker.Incident.prototype.incidentDataById = function(id)
{
	if (this.incidentDataIdIndex)
	{
		var index = this.incidentDataIdIndex[id];
		if (index)
			return this.incidentData[index];
	}

	return undefined;
};

/**
 * Counts the number of contacts against each date and creates a two-dimensional array containing these fields.
 * This is used by the Timeline as its data source.
 * @returns {[]}
 * @protected
 */
BM.Layer.Marker.Incident.prototype.getContactCountByDate = function()
{
	if (this.incidentDataDateIndex.length > 0)
		return this.incidentDataDateCounts;
	else
		return [[BM.filterLimits.dateMin.valueOf(), 0], [BM.filterLimits.dateMax.valueOf(), 0]];
};

/**
 * Filters a layer's markers based on whether they fall within the specified date range. This depends on the key 'incidentDate' being set against each feature
 * @param {moment} oldMin
 * @param {moment} oldMax
 * @param {moment} newMin
 * @param {moment} newMax
 * @param {boolean} [refreshAll] - If TRUE, perform a full refresh of the selected contact layer by clearing all markers and re-adding those within the date range
 */
BM.Layer.Marker.Incident.prototype.filterMarkers = function(oldMin, oldMax, newMin, newMax, refreshAll)
{
	if (this.olLayer)
	{
		if (refreshAll)
		{
			this.hideAllMarkers();
			this.showMarkersByDate(newMin, newMax, true);
		}
		else
		{
			// Left-hand side
			if (newMin > oldMin)
				this.showMarkersByDate(oldMin, (oldMax > newMin ? newMin : oldMax), false);
			else if (newMin <= oldMin)
				this.showMarkersByDate(newMin, (oldMin < newMax ? oldMin : newMax), true);

			// Right-hand side
			if (oldMax > newMax)
				this.showMarkersByDate((oldMin > newMax ? oldMin : newMax), oldMax, false);
			else if (oldMax <= newMax)
				this.showMarkersByDate((oldMax > newMin ? oldMax : newMin), newMax, true);
		}

		this.olLayer.getSource().changed();
		console.log('Filtered markers between ' + newMin.format('DD/MM/YYYY') + ' and ' + newMax.format('DD/MM/YYYY'));
	}
};

/**
 * Executes the provided function once for each marker that falls within the given date range
 * @param {moment} startDate
 * @param {moment} endDate
 * @param callback - Invoked once per marker
 * @returns {number} - Number of markers processed
 */
BM.Layer.Marker.Incident.prototype.forEachMarkerWithinDateRange = function(startDate, endDate, callback)
{
	if (this.olLayer)
	{
		var startOffset = this.getDateOffset(startDate);
		var endOffset = this.getDateOffset(endDate);
		var markers = this.markers.getArray();
		var dateIndexArray = this.incidentDataDateIndex;
		var markersToProcess = [];

		if (startOffset <= endOffset)
		{
			for(var i = startOffset; i <= endOffset; i++)
			{
				$.each(dateIndexArray[i], function(i, dateIndex) {
					if (dateIndex !== undefined)
					{
						var marker = markers[dateIndex];
						if (marker)
							markersToProcess.push(marker);
					}
				});
			}

			markersToProcess.forEach(callback);
			return markersToProcess.length;
		}
		else
		{
			throw new Error('Start offset exceeded end offset');
		}
	}

	return 0;
};

/**
 * Highlights/unhighlights markers based on their date/time
 * @param {moment} startDate
 * @param {moment} endDate
 * @param {boolean} highlightState - If TRUE, highlights each marker. Otherwise unhighlight it.
 */
BM.Layer.Marker.Incident.prototype.highlightMarkersByDate = function(startDate, endDate, highlightState)
{
	if (this.olLayer)
	{
		var self = this;

		this.unhighlightMarkers();
		var numberProcessed = this.forEachMarkerWithinDateRange(startDate, endDate, function(item) {
			self.lastHighlightedMarkers.push(item);
			item.set('highlighted', highlightState, true);
		});

		if (numberProcessed > 0)
			this.olLayer.getSource().changed();
	}
};

/**
 * @protected
 */
BM.Layer.Marker.Incident.prototype.unhighlightMarkers = function()
{
	$.each(this.lastHighlightedMarkers, function(i, item) {
		if (item)
			item.set('highlighted', false, true);
	});

	this.lastHighlightedMarkers = [];

	if (this.olLayer)
		this.olLayer.getSource().changed();
};

/**
 * Highlights markers when the corresponding date range is selected in the Timeline. This type of highlight is triggered on click,
 * instead of hover.
 * @param {moment} startDate
 * @param {moment} endDate
 * @param {boolean} selectedState - If TRUE, highlights each marker. Otherwise unhighlight it.
 */
BM.Layer.Marker.Incident.prototype.highlightSelectMarkersByDate = function(startDate, endDate, selectedState)
{
	if (this.olLayer)
	{
		var self = this;
		var numberProcessed = this.forEachMarkerWithinDateRange(startDate, endDate, function(item) {
			if (selectedState)
				self.lastHighlightSelectedMarkers.push(item);

			item.set('highlightSelected', selectedState, true);
		});

		if (numberProcessed > 0)
			this.olLayer.getSource().changed();
	}
};

/**
 * Given a date range, adds/removes each corresponding marker in the stored contact array to the layer (and therefore, the map)
 * @param {moment} startDate
 * @param {moment} endDate
 * @param {boolean} show - Whether to show (TRUE) or hide (FALSE) each marker
 */
BM.Layer.Marker.Incident.prototype.showMarkersByDate = function(startDate, endDate, show)
{
	if (this.olLayer)
	{
		this.forEachMarkerWithinDateRange(startDate, endDate, function(item) {
			item.set('visible', show, true);
		});
	}
};

/**
 * Dims all markers except for those with an incident ID contained in the specified array
 * @param {[]} [except] - Incident IDs of markers that should not to be dimmed
 */
BM.Layer.Marker.Incident.prototype.dimMarkers = function(except)
{
	var self = this;
	this.markers.forEach(function(marker) {
		marker.set('dimmed', true, true);
	});

	if (except)
	{
		var index = this.incidentDataIdIndex;
		$.each(except, function(i, item) {
			var id = index[item];
			if (id)
			{
				var marker = self.markers.getArray()[id];
				marker.set('dimmed', false, true);
			}
		});
	}

	this.olLayer.getSource().changed();
};

BM.Layer.Marker.Incident.prototype.undimMarkers = function()
{
	this.markers.forEach(function(marker) {
		marker.set('dimmed', false, true);
	});

	this.olLayer.getSource().changed();
};

/**
 * Triggers a selection event notifying that the marker has been selected
 * @param {ol.Feature} marker
 * @private
 */
BM.Layer.Marker.Incident.prototype.triggerMarkerSelected = function(marker)
{
	$('body').trigger($.Event('bm:incidentmarker.selected', {
		feature: marker,
		markerID: marker.get(this.markerIdKey),
		layer: this
	}));
};

/**
 * Triggers a selection event notifying that the marker has been deselected
 * @param {ol.Feature} marker
 * @private
 */
BM.Layer.Marker.Incident.prototype.triggerMarkerDeselected = function(marker)
{
	$('body').trigger($.Event('bm:incidentmarker.deselected', {
		feature: marker,
		markerID: marker.get(this.markerIdKey),
		layer: this
	}));
};