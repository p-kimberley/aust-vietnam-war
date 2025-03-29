
BM.TimelineTrackTypes = {
	trackTypeUnit: 'track-type-unit',
	trackTypeOperation: 'track-type-op',
	trackTypeUnitTask: 'track-type-task'
};

/**
 * Base class that provides a way of tracking incidents by a data field, such as Operation.
 * Tracking is performed by date/time and connected incidents are joined visually by lines.
 * Hierarchical tracking is supported, where children of a track target are also tracked and treated
 * as sub-elements.
 * @param {string} name
 * @param {jQuery} targetSelectorContainer - DOM element to use for populating target selector UI controls (i.e. unit tree)
 * @param {jQuery} navigatorDateElement - Element containing the date display for the currently selected incident
 * @constructor
 * @class
 */
BM.TimelineTrackType = function(name, targetSelectorContainer, navigatorDateElement) {
	var self = this;
    this.name = name;
	this.active = false;
	this.targetSelectorContainer = targetSelectorContainer;
	this.targetSelectorElement = this.targetSelectorContainer.append($(document.createElement('div'))).hide();
	this.navigatorDateElement = navigatorDateElement;

	/**
	 * Tree-based array containing track targets. Nesting allows for hierarchical structures to be tracked.
	 * @type {[{incidents,children}]}
	 */
	this.trackTargets = [];

	/**
	 * Level of the tree that is being tracked. All incidents and subordinate targets within this can be selected
	 * @type {{incidents,children}}
	 */
	this.selectedTarget = undefined;

	/**
	 * Ordered 1-dimensional array of incidents, crea
	 * @type {Array}
	 */
	this.targetIncidents = [];

	/**
	 * Index of the incident within the ordered target incidents array, which is currently selected
	 * @type {Number} - Index into this.targetIncidents
	 */
	this.selectedIncident = undefined;

	/** @type {BM.TimelineSeries} */
	this.timelineSeries = undefined;
	this.selectedTimelineDate = undefined;

	/**
	 * @type {ol.Collection}
	 */
	this.connectingLineLayer = undefined;
	this.connectingLines = new ol.Collection();
	this.firstIncident = undefined;
	this.lastIncident = undefined;

	$('body')
		.on('bm:timeline.changed', function(event) {
			self.onTimelineChanged(event);
		})
		.on('bm:timeline.expand-changed', function(event) {
			if (event.expanded && self.selectedTimelineDate)
				self.timelineSeries.selectPointByDate(self.selectedTimelineDate);
		})
		.on('bm:incidentmarker.selected', function(event) {
			self.goToByIncidentId(event.markerID, false);
		});
};

/**
 * Returns a description of the current track target (i.e. 'Currently tracking 7 RAR')
 * @returns {string}
 * @abstract
 */
BM.TimelineTrackType.prototype.getDescription = function() {};

BM.TimelineTrackType.prototype.getSelectedDate = function()
{
	if (this.selectedIncident)
		return this.targetIncidents[this.selectedIncident].DTG;
	else
		return null;
};

BM.TimelineTrackType.prototype.setActive = function(active)
{
	this.active = active;

	if (active)
	{
		this.targetSelectorElement.show();
	}
	else
	{
		var markerLayer = BM.LayerPanel.layerController.getSelectedLayerInGroup(BM.LayerGroupType.contact);
		if (markerLayer)
			markerLayer.undimMarkers();

		this.targetSelectorElement.hide();
		this.destroyConnectingLines();
		BM.Timeline.removeSeries(this.timelineSeries);
	}
};

/**
 * @protected
 */
BM.TimelineTrackType.prototype.populateOptions = function() {};

/**
 * Populates target tree via data query
 * @protected
 * @abstract
 */
BM.TimelineTrackType.prototype.populateTargets = function() {};

/**
 * @param targetId - ID of the entity to set as the track target (i.e. a unit)
 * @param {Number} [initialIncidentId] - Start with this incident selected
 * @abstract
 */
BM.TimelineTrackType.prototype.setTrackTarget = function(targetId, initialIncidentId) {};

/**
 * Acts on the target selection being changed.
 * Should be called when the track target is changed (i.e. a unit is selected).
 */
BM.TimelineTrackType.prototype.targetChanged = function()
{
	if (!this.selectedTarget)
		return;

	var self = this;
	this.populateTargets();

	// Ordered array of all incidents
	this.targetIncidents = [];

	// 1-dimensional array of all incident IDs. This is used to dim all other contacts on the map
	var incidentIds = [];
	var processNode = function(node) {
		$.each(node.incidents, function(i, incident) {
			incidentIds.push(incident.ID);
			incident.DTG = moment(incident.DTG);
			self.targetIncidents.push(incident);
		});
		$.each(node.children, function(i, child) {
			processNode(child);
		});
	};

	$.each(this.trackTargets, function(i, target) {
		processNode(target);
	});

	// Sort all selected target incidents by date/time to allow efficient sequential navigation
	this.targetIncidents.sort(function(a, b) {
		if (a.DTG < b.DTG)
			return -1;
		else if(a.DTG > b.DTG)
			return 1;
		else
			return 0;
	});

	if (this.targetIncidents.length > 0)
	{
		this.firstIncident = this.targetIncidents[0];
		this.lastIncident = this.targetIncidents[this.targetIncidents.length - 1];
	}

	if (this.selectedIncident > this.targetIncidents.length)
		this.selectedIncident = 0;

	var markerLayer = BM.LayerPanel.layerController.getSelectedLayerInGroup(BM.LayerGroupType.contact);
	if (markerLayer)
		markerLayer.dimMarkers(incidentIds);

	BM.TimelineTracker.setExpanded(false);
	BM.TimelineTracker.setTrackHeading(this.getDescription());
	this.generateTimelineSeries();
	this.generateConnectingLines();
	BM.map.renderSync();
	this.fitViewToIncidents();
};

/**
 * Fits the map view to the incidents' extent
 * @private
 */
BM.TimelineTrackType.prototype.fitViewToIncidents = function()
{
	// If more than one incident, zoom and pan to extent. Otherwise, pan to single selected incident only
	if (this.targetIncidents.length > 1)
	{
		var points = [];
		$.each(this.targetIncidents, function(i, incident) {
			if (isNaN(incident.Location.lon) || isNaN(incident.Location.lat))
				return;

			points.push(ol.proj.fromLonLat([incident.Location.lon, incident.Location.lat], 'EPSG:3857'));
		});

		var geom = new ol.geom.MultiPoint(points);
		BM.fitViewToExtent(geom.getExtent(), 1000);
	}
};

/**
 * Generates a Timeline series for the incident track targets
 * @private
 */
BM.TimelineTrackType.prototype.generateTimelineSeries = function()
{
	var self = this;
	if (this.trackTargets.length > 0)
	{
		var dateTotals = [];
		$.each(this.targetIncidents, function (i, incident) {
			var dtg = incident.DTG.clone();
			dtg = dtg.utc().startOf('day').valueOf();
			if (dateTotals[dtg])
				dateTotals[dtg]++;
			else
				dateTotals[dtg] = 1;
		});

		var data = [];
		for (var dateKey in dateTotals)
		{
			data.push([parseInt(dateKey), dateTotals[dateKey]]);
		}

		data.sort(function(a, b) {
			if (a[0] < b[0])
				return -1;
			if (a[0] > b[0])
				return 1;
			return 0;
		});

		if (this.timelineSeries)
		{
			BM.Timeline.removeSeries(this.timelineSeries);
			this.selectedTimelineDate = undefined;
		}

		this.timelineSeries = new BM.TimelineSeries({
			type: 'line',
			name: this.trackTargets[0].displayName,
			data: data,
			color: '#a65421',
			cursor: 'pointer',
			showInNavigator: true,
			allowPointSelect: false,
			navigatorOptions: {
				lineColor: '#da8021',
				lineWidth: 1.5
			},
			marker: {
				enabled: true,
				radius: 3,
				fillColor: '#c37021',
				lineColor: '#913e19',
				symbol: 'diamond',
				states: {
					select: {
						enabled: true,
						fillColor: '#ffa521',
						lineColor: '#ffebb6',
						lineWidth: 1,
						radius: 5
					}
				}
			},
			point: {
				events: {
					click: function(event) {
						if (!this.selected)
						{
							self.onTimelinePointClick(this);
						}
					},
					select: function(event) {
						self.selectedTimelineDate = moment(this.x);
					}
				}
			}
		});

		this.timelineSeries.add();
	}
};

/**
 * Responds to the user clicking on a series point on the Timeline
 * @param point
 * @protected
 */
BM.TimelineTrackType.prototype.onTimelinePointClick = function(point)
{
	var dtg = moment(point.x);
	this.goToFirstByDate(dtg);
};

BM.TimelineTrackType.prototype.onTimelineChanged = function(event)
{
	var self = this;

	// Adjust selected incident to nearest min/max if it has fallen out of range
	if (self.targetIncidents.length > 0)
	{
		if (event.newMax < event.oldMax && self.lastIncident.DTG > event.newMax)
		{
			// Search from RHS, for the closest incident within date bounds
			for (var i = self.targetIncidents.length - 1; i >= 0; i--)
			{
				var incident = self.targetIncidents[i];
				if (incident.DTG <= event.newMax)
				{
					self.selectedIncident = i;
					break;
				}
			}
		}
		else
		{
			// Search from LHS, for the closest incident within bounds
			$.each(self.targetIncidents, function (i, incident) {
				if (incident.DTG >= event.newMin)
				{
					self.selectedIncident = i;
					return false;
				}
			});
		}

		self.goToSelected(true);
	}
	else
	{
		self.generateConnectingLines();
	}
};

/**
 * Draws vector lines connecting each incident to its date/time neighbours
 * @protected
 */
BM.TimelineTrackType.prototype.generateConnectingLines = function()
{
	var self = this;

	// Remove the layer if it already exists
	if (this.connectingLineLayer)
		BM.map.removeLayer(this.connectingLineLayer);

	this.connectingLines = [];
	var prevPoint = undefined;
	var dateExtremes = BM.Timeline.getExtremes();

	if (this.trackTargets.length > 0)
	{
		var styleFn = function (feature, resolution) {
			if (self.selectedIncident)
			{
				var dtg = feature.get('incident').DTG.valueOf();

				// Use inner-most date range for calculating colour range
				var minDate = self.firstIncident.DTG > dateExtremes.min ? self.firstIncident.DTG.valueOf() : dateExtremes.min;
				var maxDate = self.lastIncident.DTG < dateExtremes.max ? self.lastIncident.DTG.valueOf() : dateExtremes.max;
				var selectedIncidentDate = self.targetIncidents[self.selectedIncident].DTG.valueOf();
				var alpha = Math.max(1.0 - Math.sqrt(Math.abs((dtg - selectedIncidentDate) / (maxDate - minDate))) * 2.0, 0.15);

				var colour = chroma('rgb(255, 129, 51)').alpha(alpha);
				if (colour)
				{
					return [
						new ol.style.Style({
							stroke: new ol.style.Stroke({
								color: colour.css(),
								width: 2
							})
						})
					];

				}
			}
		};

		$.each(this.targetIncidents, function(i, incident) {
			// Render if the location is valid and if the incident falls within the Timeline's selected date limits
			if (incident.DTG > dateExtremes.max)
				return false;

			if (incident.Location.lon && incident.Location.lat && incident.DTG >= dateExtremes.min)
			{
				var point = ol.proj.fromLonLat([incident.Location.lon, incident.Location.lat], 'EPSG:3857');
				if (prevPoint)
				{
					var lineFeature = new ol.Feature({
						geometry: new ol.geom.LineString([prevPoint, point])
					});

					lineFeature.set('incident', incident);
					self.connectingLines.push(lineFeature);
				}

				prevPoint = point;
			}
		});

		this.connectingLineLayer = new ol.layer.Vector({
			source: new ol.source.Vector({
				features: this.connectingLines
			}),
			style: styleFn,
			updateWhileAnimating: true
		});

		this.connectingLineLayer.setZIndex(400);
		BM.map.addLayer(this.connectingLineLayer);
	}
	else
	{
		// No lines to draw
	}
};

/**
 * @private
 */
BM.TimelineTrackType.prototype.destroyConnectingLines = function()
{
	if (this.connectingLineLayer)
	{
		BM.map.removeLayer(this.connectingLineLayer);
		this.connectingLineLayer = undefined;
	}
};

/**
 * Selects the incident matching the specified ID
 * @param {Number} incidentId
 * @param {boolean} panToIncident - If TRUE, pans the view to the target incident
 */
BM.TimelineTrackType.prototype.goToByIncidentId = function(incidentId, panToIncident)
{
	var self = this;

	$.each(this.targetIncidents, function (i, incident) {
		if (incident.ID == incidentId)
		{
			self.selectedIncident = i;
			self.goToSelected(panToIncident);
			return false;
		}
	});
};

/**
 * Selects the first incident occurring on or after the selected date/time
 * @param {moment} dtg
 */
BM.TimelineTrackType.prototype.goToFirstByDate = function(dtg)
{
	var self = this;

	$.each(this.targetIncidents, function (i, incident) {
		if (incident.DTG >= dtg)
		{
			self.selectedIncident = i;
			self.goToSelected(true);
			return false;
		}
	});
};

/**
 * Updates the view to reflect the current selected incident
 * @param {boolean} panToIncident
 * @private
 */
BM.TimelineTrackType.prototype.goToSelected = function(panToIncident)
{
	var selectedDate = "No incident selected";
	if (this.targetIncidents.length > 0 && this.active)
	{
		this.generateConnectingLines();

		if (this.selectedIncident >= 0 && this.selectedIncident < this.targetIncidents.length)
		{
			var selectedIncident = this.targetIncidents[this.selectedIncident];
			selectedDate = selectedIncident.DTG.format('DD/MM/YYYY HH:mm:ss');
			this.timelineSeries.selectPointByDate(selectedIncident.DTG);

			if (panToIncident)
				BM.MarkerPanel.showForIncidentByID(selectedIncident.ID, true, 1000);
			else
				BM.MarkerPanel.showForIncidentByID(selectedIncident.ID);

			BM.TimelineTracker.updateSeekButtons();
		}
	}

	this.navigatorDateElement.text(selectedDate);
};

/**
 * Selects the next successive incident in the target branch and shifts and camera to centre on the incident
 * @param {boolean} [panToIncident] - If TRUE, pans the view to the target incident
 */
BM.TimelineTrackType.prototype.goNext = function(panToIncident)
{
	if (this.targetIncidents.length > 0 && this.selectedIncident < this.targetIncidents.length - 1)
	{
		this.selectedIncident++;
		this.goToSelected(panToIncident);
	}
};

/**
 * @param {boolean} [panToIncident] - If TRUE, pans the view to the target incident
 */
BM.TimelineTrackType.prototype.goPrev = function(panToIncident)
{
	if (this.targetIncidents.length > 0 && this.selectedIncident > 0)
	{
		this.selectedIncident--;
		this.goToSelected(panToIncident);
	}
};

/**
 * @returns {boolean}
 */
BM.TimelineTrackType.prototype.isAtBeginning = function()
{
	return this.selectedIncident == 0;
};

/**
 * @returns {boolean}
 */
BM.TimelineTrackType.prototype.isAtEnd = function()
{
	return this.selectedIncident == this.targetIncidents.length - 1;
};