var BM = BM || {};

BM.StateManagement = (function()
{
	var _popStateDisarmed = false;                  // Workaround for a bug in HistoryJS that invokes popState each time pushState is called
	var _mapCentre = null;                          // Explicitly-defined 'at' location that can be set in order to override the current reported location
	var _initialStateLoaded = false;                // Whether the URL state passed on initial page load has been processed. Calls to pushState and replaceState are blocked until TRUE
	var _initialStateLoadedCallbacks = [];          // Array of callback functions belonging to subscribers wanting notification of the initial state loading being completed
	var _stateRestorationInProgress = false;        // TRUE if state restoration is in progress

	// These key/value pairs relate to state variables that are not included in the URL.
	// They are used by the pushState and popState methods
	var _dataStateKeyValueArray = [
		['fullscreen', null],
		['incident-panel', null],
		['layer-panel', null],
		['layer-panel-pinned', null],
		['media-panel', null]
	];

	// These key/value pairs are parsed from URL parameters and are used to create 'deep links'
	// to Battle Map view states. They are processed in order from first to last
	var _urlStateKeyValueArray = [                  // PARAMETER VALUE FORMAT:
		['contact-filter', null],                   // Semi-colon separated list of filters and their values
		['basemap', null],                          //
		['layers', null],                           //
		['timeline', null],                         // Timeline date range
		['incident', null],                         // <Incident ID>
		['incident-note', null],                    // <Incident note ID>
		['at', null],                               // <Lat>,<Lng>,<Zoom>
		['chart', null]                             // <ifreq_month|ifreq_day|bdmg_month|bdmg_day|ceff_month|ceff_day|ccauses>
	];

	function _serialiseUrlState()
	{
		_clearAllKeyValues();

		// If an explicit map centre point is defined, use this instead of the current point
		var mapView = BM.map.getView();
		var mapCentre = mapView.getCenter();

		if (mapCentre)
		{
			var mapCentreProj = ol.proj.toLonLat(mapCentre, 'EPSG:4326');

			// Current look-at location and zoom
			_setKeyValue(_urlStateKeyValueArray, 'at', mapCentreProj[1] + ',' + mapCentreProj[0] + ',' + mapView.getZoom());
		}
		else
		{
			console.warn('Map not initialised prior to state view restoration');
		}

		// Incident selected (marked popup activated)
		var currentIncidentID = BM.MarkerPanel.getCurrentIncidentID();
		if (currentIncidentID > 0)
			_setKeyValue(_urlStateKeyValueArray, 'incident', BM.MarkerPanel.getCurrentIncidentID());

		// Currently opened incident note
		if (BM.IncidentNote.getCurrentNoteID() > 0)
			_setKeyValue(_urlStateKeyValueArray, 'incident-note', BM.IncidentNote.getCurrentNoteID());

		// Selected basemap
		var basemap = BM.LayerPanel.basemapController.serialiseState();
		if (basemap.length > 0)
			_setKeyValue(_urlStateKeyValueArray, 'basemap', basemap);

		// Layer panel
		var layerState = BM.LayerPanel.layerController.serialiseState();
		if (layerState.length > 0)
			_setKeyValue(_urlStateKeyValueArray, 'layers', layerState);

		// Contact filters
		var contactFilter = BM.FilterPanel.contactFilterController.serialiseState();
		if (contactFilter.length > 0)
			_setKeyValue(_urlStateKeyValueArray, 'contact-filter', contactFilter);

		// Timeline state. This is not set if the selected date range is wider than the min/max date range
		var timelineState = BM.Timeline.serialiseState();
		if (timelineState.length > 0)
			_setKeyValue(_urlStateKeyValueArray, 'timeline', timelineState);

		// Chart
		var chartState = BM.AnalyticsPanel.chartController.serialiseState();
		if (chartState.length > 0)
			_setKeyValue(_urlStateKeyValueArray, 'chart', chartState);

		// Combine all set key/value pairs into a serialised URL state string
		var serialisedUrlState = "?";
		var hasStateParameters = false;
		for(var i = 0; i < _urlStateKeyValueArray.length; i++)
		{
			if (_urlStateKeyValueArray[i][1] !== null)
			{
				if (hasStateParameters)
					serialisedUrlState += '&';
				else
					hasStateParameters = true;

				serialisedUrlState += _urlStateKeyValueArray[i][0] + '=' + _urlStateKeyValueArray[i][1];
			}
		}

		return serialisedUrlState;
	}

	// Sets the value of the specified key in the array during serialisation/deserialisation
	function _setKeyValue(keyValueArray, key, value)
	{
		var assignedValue = false;
		for(var i = 0; i < keyValueArray.length; i++)
		{
			if (keyValueArray[i][0] === key)
			{
				keyValueArray[i][1] = value;
				assignedValue = true;
			}
		}

		if (!assignedValue)
			console.log('Invalid state key provided: "' + key + '"')
	}

	// Nulls all values to prepare for a serialise/deserialise operation
	function _clearAllKeyValues()
	{
		for(var i = 0; i < _dataStateKeyValueArray.length; i++)
			_dataStateKeyValueArray[i][1] = null;

		for(i = 0; i < _urlStateKeyValueArray.length; i++)
			_urlStateKeyValueArray[i][1] = null;
	}

	// Returns whether the specified parameter key was specified and if a value was defined
	function _isUrlParamSpecified(paramKey)
	{
		for(var i = 0; i < _urlStateKeyValueArray.length; i++)
		{
			if (_urlStateKeyValueArray[i][0] === paramKey && _urlStateKeyValueArray[i][1])
				return true;
		}

		return false;
	}

	/**
	 * Returns whether a map move operation is likely to occur. This is based on URL initialisation parameters and if a popState operation
	 * is in progress
	 * @returns {boolean}
	 * @private
	 */
	function _isMapMovePending()
	{
		if (_stateRestorationInProgress)
		{
			if (_isUrlParamSpecified('at'))
				return true;
		}

		return false;
	}

	// Logs an error with popState to the console
	function _logPopStateParameterError(urlParamKey, error)
	{
		console.log('Error occurred when parsing URL parameter: ' + urlParamKey + '. ' + error.message);
	}

	/**
	 * Carries out initialisation actions based on the specified URL parameters. Invokes the initial state loaded callback subscriber functions
	 * once state restoration is completed
	 * @param callback
	 * @private
	 */
	function _processUrlKeyValueArray(callback)
	{
		// Recursively process all URL parameters
		_processUrlParameters(function(processedParameters) {
			console.log('Successfully processed ' + processedParameters + ' parameters');
			if (callback)
				callback();
		});
	}

	/**
	 * Processes all URL parameters, carrying out init actions for each.
	 * This contains a recursive function that for init actions with synchronous dependencies (i.e. incident notes requiring the incident
	 * popup to be loaded), passes a self reference as a callback hook, with an incremented 'currentIndex' parameter
	 * @param callback - Called on successful completion. Requires function with single parameter, which is the number of successfully processed URL parameters
	 * @private
	 */
	function _processUrlParameters(callback)
	{
		var processParameter = function(i, processedParameters)
		{
			// Detect when all parameters have been processed
			if (i >= _urlStateKeyValueArray.length)
			{
				if (callback)
					callback(processedParameters);

				return;
			}

			var paramKey = _urlStateKeyValueArray[i][0];
			var paramValue = _urlStateKeyValueArray[i][1];
			
			switch (paramKey)
			{
				case 'at':
					if (paramValue)
					{
						try
						{
							var latLonZoom = paramValue.split(',');
							var lat = parseFloat(latLonZoom[0]);
							var lon = parseFloat(latLonZoom[1]);
							var coords;
							if (isNaN(lat) || isNaN(lon))
							{
								console.warn('Parameter "at" contains invalid lat/lon coords');
								coords = BM.map.getView().getCenter();
							}
							else
							{
								coords = ol.proj.fromLonLat([lon, lat], 'EPSG:4326');
							}

							var zoom = Number(latLonZoom[2]);
							if (isNaN(zoom))
							{
								console.warn('Parameter "at" contains an invalid zoom level');
								zoom = BM.map.getView().getZoom();
							}

							console.log('Panning to: ' + coords.toString());
							BM.flyTo(coords, zoom, 1000);

							return processParameter(i + 1, processedParameters + 1);
						}
						catch (error)
						{
							_logPopStateParameterError(paramKey, error);
							return processParameter(i + 1, processedParameters);
						}
					}
					else
					{
						return processParameter(i + 1, processedParameters);
					}
					return;
				case 'incident':
					if (paramValue)
					{
						try
						{
							var incidentID = Number(paramValue);
							var contactLayer = BM.LayerPanel.layerController.getSelectedLayerInGroup(BM.LayerGroupType.contact);
							contactLayer.check(function() {
								var result = BM.MarkerPanel.showForIncidentByID(incidentID, true);
								if (result)
									return processParameter(i + 1, processedParameters + 1);
								else
									throw new Error();
							});
						}
						catch(error)
						{
							console.warn('Invalid incident ID provided: ' + paramValue + '. ' + error.message);
							return processParameter(i + 1, processedParameters);
						}
					}
					else
					{
						// If no incident parameter, close the marker sidebar if it is open
						if (BM.MarkerPanel.getCurrentIncidentID() > 0)
							BM.RightSidebar.setVisible(false);

						return processParameter(i + 1, processedParameters);
					}
					return;
				case 'incident-note':
					if (paramValue)
					{
						try
						{
							var noteID = Number(paramValue);
							BM.IncidentNote.displayNote(noteID);
							return processParameter(i + 1, processedParameters + 1);
						}
						catch (error)
						{
							_logPopStateParameterError(paramKey, error);
							return processParameter(i + 1, processedParameters);
						}
					}
					else
					{
						return processParameter(i + 1, processedParameters);
					}
				case 'basemap':
					var defaultBasemap = BM.LayerPanel.basemapController.getBasemap(BM.BasemapType.mapbox.terrain);
					if (paramValue)
					{
						var basemap = BM.LayerPanel.basemapController.getBasemap(paramValue);
						if (basemap)
						{
							BM.LayerPanel.basemapController.selectBasemap(basemap);
							return processParameter(i + 1, processedParameters + 1);
						}
						else
						{
							BM.LayerPanel.basemapController.selectBasemap(defaultBasemap);
							return processParameter(i + 1, processedParameters);
						}
					}
					else
					{
						BM.LayerPanel.basemapController.selectBasemap(defaultBasemap);
						return processParameter(i + 1, processedParameters);
					}
				case 'layers':
					if (paramValue)
					{
						console.log('Processing layers');
						BM.LayerPanel.layerController.parseState(paramValue, function (layersProcessed) {
							console.log('Successfully processed ' + layersProcessed + ' layers');
							return processParameter(i + 1, processedParameters + 1);
						});
					}
					else
					{
						// Apply a default map view in the absence of a URL parameter
						BM.LayerPanel.layerController.showLayer(BM.LayerType.contact.individual);
						return processParameter(i + 1, processedParameters);
					}
					return;
				case 'timeline':
					if (!_initialStateLoaded)
					{
						BM.Timeline.init(function() {
							if (paramValue)
							{
								BM.Timeline.parseState(paramValue);
								return processParameter(i + 1, processedParameters + 1);
							}
							else
							{
								return processParameter(i + 1, processedParameters);
							}
						});
					}
					else if(paramValue)
					{
						BM.Timeline.parseState(paramValue);
						return processParameter(i + 1, processedParameters + 1);
					}
					return;
				case 'contact-filter':
					if (paramValue)
					{
						BM.FilterPanel.contactFilterController.parseState(paramValue);
						BM.FilterPanel.applyFilter();
						return processParameter(i + 1, processedParameters + 1);
					}
					else
					{
						// Retrieve unfiltered contact data
						return processParameter(i + 1, processedParameters);
					}
					return;
				case 'chart':
					if (paramValue)
					{
						BM.AnalyticsPanel.chartController.parseState(paramValue);
						return processParameter(i + 1, processedParameters + 1);
					}
					else
					{
						return processParameter(i + 1, processedParameters);
					}
				default:
					return processParameter(i + 1, processedParameters);
			}
		};

		// Start parameter processing
		processParameter(0, 0);
	}

	return {
		isMapMovePending: _isMapMovePending,
		initialStateLoaded: function() { return _initialStateLoaded; },
		stateRestorationInProgress: function() { return _stateRestorationInProgress; },

		/**
		 * Registers a callback that will be fired when the initial state loading is completed
		 * @param callback
		 */
		onInitialStateLoaded: function(callback)
		{
			if (_initialStateLoaded)
				console.log('Warning: onInitialStateLoaded function call performed out of sequence. Initial state already loaded.');
			else if (callback)
				_initialStateLoadedCallbacks.push(callback);
		},

		pushState: function()
		{
			console.log('pushState');

			if (_initialStateLoaded)
			{
				// Disable 'pop' processing for the next function call
				_popStateDisarmed = true;
				History.pushState(null, null, _serialiseUrlState());
				document.title = BM.documentTitle;
			}
		},

		replaceState: function()
		{
			if (_initialStateLoaded)
			{
				var serialisedState = _serialiseUrlState();
				console.log('replaceState: ' + serialisedState);
				_popStateDisarmed = true;
				History.replaceState(null, null, serialisedState);
				document.title = BM.documentTitle;
			}
		},

		/**
		 * Restores the browser state by de-serialising parameters
		 * @param data
		 * @param title - Not used
		 * @param url - URL containing the URI and query parameters
		 */
		popState: function(data, title, url)
		{
			// Block further calls to this method if restoration is already in progress
			if (_popStateDisarmed || _stateRestorationInProgress)
			{
				_popStateDisarmed = false;
				return;
			}

			_stateRestorationInProgress = true;

			var paramStartPosition = url.indexOf('?');
			var i, j;

			// Clear key/value array before populating it
			_clearAllKeyValues();

			// Clear any explicitly-defined map centre point
			_mapCentre = null;

			// Convert the URL parameters into an array
			if (paramStartPosition >= 0 && paramStartPosition < url.length)
			{
				var urlParams = url.substr(paramStartPosition + 1);
				var urlParamKeyValues = urlParams.split('&');

				// Add all recognised parameters to the key/value array for processing
				for(i = 0; i < urlParamKeyValues.length; i++)
				{
					var equalPosition = urlParamKeyValues[i].indexOf('=');
					if (equalPosition >= 0)
					{
						var keyValueArray = urlParamKeyValues[i].split('=');
						var key = keyValueArray[0];
						var value = keyValueArray[1];

						// Value has been specified, so add it to the url state array if it matches a key
						for (j = 0; j < _urlStateKeyValueArray.length; j++)
						{
							if (key === _urlStateKeyValueArray[j][0] && value)
								_urlStateKeyValueArray[j][1] = value;
						}
					}
				}
			}

			// Process the array containing URL keys and values, which is now populated
			_processUrlKeyValueArray(function() {
				// Browser URL state loaded, so allow calls to pushState and replaceState
				_initialStateLoaded = true;
				_stateRestorationInProgress = false;

				document.title = BM.documentTitle;

				// Invoke callbacks in FIFO sequence
				for(var i = 0; i < _initialStateLoadedCallbacks.length; i++)
				{
					_initialStateLoadedCallbacks[i]();
				}

				_initialStateLoadedCallbacks = [];
			});
		}
	}
})();