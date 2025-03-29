/**
 * Compact, embedded map display module
 */
var Map = (function() {
	var _map;
	var _incidents = [];
	var _selectedIncident = undefined;
	var _features = [];
	var _layerNames = [];
	var _normalPointColor = '#a81414';
	var _selectedPointColor = '#ff0000';

	/**
	 * Initialises the map using default options
	 * @param {string} accessToken
	 * @param {{}} options - See MapboxGL#Map reference
	 * @return {mapboxgl.Map}
	 * @private
	 */
	function _initMap(accessToken, options)
	{
		mapboxgl.accessToken = accessToken;
		_map = new mapboxgl.Map(options);

		var navigator = jQuery('#incident-navigator');
		navigator.find('.arrow.left').click(function() {
			_goPrev();
		});
		navigator.find('.arrow.right').click(function() {
			_goNext();
		});
	}

	function _resize()
	{
		if (_map)
			_map.resize();
	}

	function _createIncidentLayer(incidentData)
	{
		_features = [];
		_incidents = [];

		for(var i = 0; i < incidentData.length; i++)
		{
			var incident = incidentData[i];
			var fields = incident._source;

			if (fields.Location)
			{
				var feature = {
					"id": incidentData[i]._id,
					"type": "Feature",
					"geometry": {
						"type": "Point",
						"coordinates": [fields.Location.lon, fields.Location.lat]
					},
					"properties": {
						"id": incident._id,
						"title": fields.DTG,
						"icon": "star",
						"description": "An incident",
						"marker-color": "#3bb2d0",
						"marker-size": "large",
						"marker-symbol": (i + 1).toString()
					}
				};

				_features.push(feature);
				_incidents.push(incident);
			}
		}

		if (_features.length > 0)
		{
			_map.on('load', function() {
				var allPointsGeoJson = {
					"type": "FeatureCollection",
					"features": _features
				};

				jQuery.each(_features, function(i, feature) {
					var geojson = {
						"type": "FeatureCollection",
						"features": [feature]
					};

					var pointId = "point-" + feature.id;
					_map.addSource(pointId, {
						"type": "geojson",
						"data": geojson
					});

					_map.addLayer({
						"id": pointId,
						"type": "circle",
						"source": pointId,
						"paint": {
							"circle-radius": 5,
							"circle-color": _normalPointColor,
							"circle-stroke-color": "#ffffff",
							"circle-stroke-width": 1
						}
					});

					_layerNames.push(pointId);
				});

				var bounds = geojsonExtent(allPointsGeoJson);
				var centre = [bounds[0] + (bounds[2] - bounds[0]) / 2, bounds[1] + (bounds[3] - bounds[1]) / 2];
				_map.setCenter(centre);
				_map.setZoom(5);
				_map.setPitch(60);

				setTimeout(function() {
					_map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
						padding: 0,
						offset: [0, -50],
						maxZoom: 12
					});

					_selectIncident(0);
				}, 1000);

				jQuery('#load-incident-in-battlemap').find('button').click(function() {
					var incident = _incidents[_selectedIncident];
					_loadIncidentInBattlemap(incident._id);
				});
			});

			_map.on('click', function(e) {
				var features = _map.queryRenderedFeatures(e.point, {
					layers: _layerNames
				});

				if (!features.length)
					return;

				var feature = features[0];
				_selectIncidentById(feature.properties.id);
			});

			_map.on('mousemove', function(e) {
				var features = _map.queryRenderedFeatures(e.point, {
					layers: _layerNames
				});

				_map.getCanvas().style.cursor = (features.length) ? 'pointer' : '';
			});
		}
	}

	/**
	 * Loads the specified incident ID in the Battlemap
	 * @param {Number} incidentId
	 * @private
	 */
	function _loadIncidentInBattlemap(incidentId)
	{
		if (incidentId)
			window.location.href = '/battlemap?incident=' + incidentId;
	}

	function _selectIncident(index)
	{
		var prevSelected = _selectedIncident != undefined ? _incidents[_selectedIncident] : undefined;
		_selectedIncident = index;
		var incident = _incidents[_selectedIncident];

		if (prevSelected)
			_map.setPaintProperty('point-' + prevSelected._id, 'circle-color', _normalPointColor);

		if (incident)
		{
			var details = jQuery('#incident-navigator').find('.incident-details');
			var dtg = moment(incident._source.DTG, 'YYYY-MM-DDTHH:mm:ss').format('DD MMM YYYY HH:mm');

			_map.setPaintProperty('point-' + incident._id, 'circle-color', _selectedPointColor);
			details.fadeOut(200, function () {
				details.find('.date').text(dtg);
				details.find('.description').text(incident._source.Description_of_Incident);
				details.fadeIn(200);
			});
		}
	}

	function _selectIncidentById(id)
	{
		var index = null;
		jQuery.each(_incidents, function(i, item) {
			if (item._id === id)
			{
				index = i;
				return false;
			}
		});

		_selectIncident(index);
	}

	function _goNext()
	{
		if (_selectedIncident >= _incidents.length - 1)
			_selectIncident(0);
		else
			_selectIncident(_selectedIncident + 1);
	}

	function _goPrev()
	{
		if (_selectedIncident)
			_selectIncident(_selectedIncident - 1);
		else
			_selectIncident(_incidents.length - 1);
	}

	return {
		initMap: _initMap,
		resize: _resize,
		createIncidentLayer: _createIncidentLayer
	}
}());