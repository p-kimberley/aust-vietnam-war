
BM.Tour = (function() {
	var _tourButtonDefaultTitle = 'Start a guided tour of the Battle Map';
	var _tourInProgress = false;						// Whether the tour is currently in progress
	var _tourSteps = [];								// Array of BM.TourStep objects defining the layout and behaviour of each tour step
	var _currentStep = 0;								// Current index into the array, marking the tour step the user is at

	function _startTour()
	{
		if (!_tourInProgress)
		{
			_tourInProgress = true;
			_currentStep = 0;

			BM.ActivityLogging.logEvent(BM.LogEventTypes.startedTour);

			_showTourStep(_currentStep);
			$('#map-tour-button')
				.addClass('active')
				.tooltipster('hide')
				.tooltipster('content', 'Stop the tour')
				.tooltipster('option', 'position', 'left')
				.tooltipster('reposition');
		}
		else
		{
			console.log('Warning: Tour already running');
		}
	}

	function _endTour()
	{
		if (_tourInProgress)
		{
			_tourSteps[_currentStep].endStep();
			_tourInProgress = false;
			_currentStep = 0;

			$('#map-tour-button')
				.removeClass('active')
				.tooltipster('content', _tourButtonDefaultTitle)
				.tooltipster('option', 'position', 'bottom')
				.tooltipster('reposition');
		}
		else
		{
			console.log('Warning: Tour not running; nothing to stop');
		}
	}

	/**
	 * Shows the tooltip for the specified tour step
	 * @param {number} step
	 * @private
	 */
	function _showTourStep(step)
	{
		if (step < _tourSteps.length)
			_tourSteps[step].showStep();
	}

	/**
	 * Displays the next step tooltip and if at the end, notifies the user of successful completion
	 * @private
	 */
	function _nextTourStep()
	{
		if (_tourInProgress)
		{
			if (_currentStep + 1 >= _tourSteps.length)
			{
				_endTour();
			}
			else
			{
				_tourSteps[_currentStep].endStep(function () {
					_showTourStep(++_currentStep);
				});
			}
		}
	}

	function _populateTourSteps()
	{
		var layerController = BM.LayerPanel.layerController;
		var contactsClustered = layerController.getLayer(BM.LayerType.contact.clustered);

		_tourSteps.push(new BM.TourStep({
			title: 'Guided Tour of the Battle Map',
			buttonText: '<strong>Start the Tour</strong>',
			position: 'bottom',
			body: '<p>Let\'s get started with a step-by-step tour of the main features of the Battle Map.</p>' +
				'<p>You can end the tour at any time by clicking the <strong>X</strong> during any tour step.</p>' +
				'<p>To get a tour popup like this out of your way, simply drag it around the screen.</p>' +
				'<p class="tour-action-step"><strong>Note:</strong> This is an <em><strong>example action step</strong></em>. In most cases, you must complete these in order to progress to the next step in the tour.</p>',
			tooltipTargetFn: function (callback) {
				callback($('#map-tour-button'));
			},
			stepCompletionFn: function(callback) {
				var checkIfClustersVisible = function() {
					if ($('.leaflet-marker-icon.marker-cluster').length > 0)
					{
						if (callback)
							callback();
					}
					else
					{
						// If no clusters exist, clear the filter
						BM.FilterPanel.clearContactFilter(callback);
					}
				};

				if (!contactsClustered.isChecked())
					contactsClustered.check(checkIfClustersVisible);
				else
					checkIfClustersVisible();
			}
		}));

		_tourSteps.push(new BM.TourStep({
			title: 'Working with the Map',
			position: 'bottom-left',
			offsetX: 10,
			body: '<p>Pan around the map using the mouse or finger (on mobile devices). Zoom using the mousewheel, or click the +/- buttons at the top-left.</p>' +
				'<p>Some of the common map symbols are:</p>' +
				'<table border="0">' +
				'<tr><td style="text-align: center"><img src="/images/Tour-Marker-Cluster.png" width="43" height="43"></td><td><strong>Marker clusters</strong> show the number of contacts in the surrounding area ' +
					'and can be clicked to reveal the contacts underneath.</td></tr>' +
				'<tr><td style="text-align: center"><img src="/images/markers/Marker-Contact.png" width="25" height="41"></td><td><strong>Contacts</strong> refer to single ground combat incidents. Selecting a contact ' +
					'marker or any of the types below, will display a <strong>popup</strong> containing more information</td></tr>' +
				'<tr><td style="text-align: center"><img src="/images/markers/Marker-AT-Blast.png" width="25" height="41"></td><td><strong>Anti-tank</strong> (AT) mine incidents</td></tr>' +
				'<tr><td style="text-align: center"><img src="/images/markers/Marker-AP-Blast.png" width="25" height="41"></td><td><strong>Anti-personnel</strong> (AP) mine incidents</td></tr>' +
				'<tr><td style="text-align: center"><img src="/images/markers/Marker-CD-Blast.png" width="25" height="41"></td><td><strong>Command-detonated (Cmd Det) explosive device</strong> incidents</td></tr>' +
				'</table>',
			buttonText: '<strong>Next:</strong> Navigating incident markers',
			buttonAlign: 'right',
			tooltipTargetFn: function (callback) {
				callback($('div.leaflet-top.leaflet-left'));
			},
			stepCompletionFn: function(callback) {
				BM.RightSidebar.setVisible(false);
				callback();
			}
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'Incident Markers',
			position: 'bottom',
			offsetY: -5,
			body: '<p>Each marker represents a single combat incident. Moving the mouse over will display a tool tip containing vital information on it.</p>' +
				'<p>Selecting an incident displays a popup containing more detailed information.</p>' +
				'<p class="tour-action-step"><strong>Click</strong> on the indicated <strong>marker</strong> to open its popup.</p>',
			tooltipTargetFn: function (callback) {
				if (contactsClustered.isChecked())
				{
					var marker = contactsClustered.getMarkerByIndex(0);
					if (marker)
					{
						contactsClustered.centreOnMarker(marker, function() {
							callback($(marker._icon));
						});

						return;
					}
				}

				// User has already figured out how to use map layers (or no markers exist), so move onto the next step
				BM.Tour.nextTourStep();
			},
			waitForTargetFn: function (callback) {
				if (contactsClustered.isChecked())
				{
					var marker = contactsClustered.getMarkerByIndex(0);
					if (marker)
					{
						if (marker._icon)
							return callback($(marker._icon));
					}
				}

				callback();
			}
		}));

		_tourSteps.push(new BM.TourStep({
			title: 'Incident Popups',
			position: 'left',
			body: '<p><strong>Move the mouse</strong> over areas of the popup to find out what they are. ' +
				'You can see the date, time and location of the incident, who was involved, the size of forces and numbers of casualties.</p>' +
				'<p>View the original post-operational report by clicking <strong>Incident Details</strong></p>' +
				'<p><strong>Incident notes</strong> provide veterans with a means to tell their story, in the context of a particular battle. You can view existing ' +
				'notes below, or upload one.</p>',
			buttonText: '<strong>Next:</strong> Customising map layers',
			buttonAlign: 'right',
			tooltipTargetFn: function (callback) {
				callback($('#incident-popup'));
			},
			stepCompletionFn: function(callback) {
				BM.RightSidebar.setVisible(false);
				callback();
			}
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'Map Layers',
			position: 'left',
			body: '<p>Click to open the Layer Panel</p>',
			tooltipTargetFn: function (callback) {
				if (BM.LayerPanel.visible)
					BM.Tour.nextTourStep();
				else
					callback($('#map-layer-button'));
			},
			waitForTargetFn: function (callback) {
				callback($('#map-layer-button'));
			}
		}));

		_tourSteps.push(new BM.TourStep({
			title: 'Map Layers',
			position: 'left',
			body: '<p>Choose from three present-day <strong>basemaps</strong>: Topographic, satellite or street.</p>' +
			'<p>Below these, you can select from a combination of <strong>overlays</strong>, which are displayed over the top of your selected basemap.</p>' +
			'<p><strong>Military maps</strong> provide Vietnam-War era overlays of Phuoc Tuy province.</p>' +
			'<p><strong>Combat incidents</strong> allow you to turn on individual contacts.</p>' +
			'<p><strong>Concentrations</strong> provide visualisations of the density of certain statistics, such as enemy casualties.</p>',
			buttonText: '<strong>Next:</strong> Applying filters to markers',
			buttonAlign: 'right',
			tooltipTargetFn: function (callback) {
				callback($('#map-layer-panel'));
			},
			stepCompletionFn: function(callback) {
				BM.RightSidebar.setVisible(false);
				callback();
			}
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'Using Filters',
			position: 'bottom',
			body: '<p>Filters allow you to find incidents of interest. You can combine them to quickly perform queries against the database.</p>' +
			'<p>Each filter heading if clicked, enables that filter. You can then set the underlying filter parameter.</p>' +
			'<p>Once you have finished entering filters, click <strong>Apply Filter</strong>. This will restrict the markers shown on the map, to those matching the filter combination.</p>' +
			'<p>We will work through an example of using filters is to find all <strong>mine</strong> incidents involving <strong>2 Platoon, A Company, 3 RAR.</strong></p>' +
			'<p class="tour-action-step">Select the <strong>Units Involved</strong> filter type</p>',
			tooltipTargetFn: function (callback) {
				var unitFilter = BM.FilterPanel.contactFilterController.getFilterById(BM.FilterID.contact.unitsInvolved);
				if (unitFilter.isChecked())
				{
					// User has already enabled the unit filter, so skip to the part where they enter text
					return BM.Tour.nextTourStep();
				}

				BM.RightSidebar.setVisible(true);
				callback(unitFilter.selectorControlContainer);
			},
			waitForTargetFn: function(callback) {
				var unitFilter = BM.FilterPanel.contactFilterController.getFilterById(BM.FilterID.contact.unitsInvolved);
				if (!unitFilter.isChecked())
					callback(unitFilter.selectorControl);
				else
					callback();
			},
			waitForInteraction: 'ifToggled'
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'The \'Units Involved\' Filter',
			position: 'bottom',
			body: '<p>This filter searches for incidents that <strong>contain</strong> part of, or a whole, unit name. ' +
			'Unit names follow a naming convention and are abbreviated. For example:</p>' +
			'<p><em>2nd Platoon, A Company, 6th Battalion</em> is stored as <strong>2 Pl A Coy 6 RAR</strong>.</p>' +
			'<p>If unsure about how a unit is spelled, try first typing just a few letters of its name.</p>' +
			'<p class="tour-action-step"><strong>Step 1.</strong> Type in <em><strong>a coy</strong></em> (this is not case sensitive)</p>' +
			'<p>A popup will appear to the right, showing all the occurrences of that unit name. All contacts with those same unit names will be shown if this filter is used.</p>' +
			'<p>If the popup contains no entries, check your spelling or make your filter less specific. We will now refine the filter to narrow our search.</p>' +
			'<p class="tour-action-step"><strong>Step 2. </strong>Change the filter to <em><strong>2 pl a coy 6 rar</strong></em></p>' +
			'<p class="tour-action-step"><strong>Step 3. </strong>Select the <strong>Incident Type</strong> filter to continue</p>',
			tooltipTargetFn: function (callback) {
				var unitFilter = BM.FilterPanel.contactFilterController.getFilterById(BM.FilterID.contact.unitsInvolved);
				var incidentTypeFilter = BM.FilterPanel.contactFilterController.getFilterById(BM.FilterID.contact.type);
				if (unitFilter.getValues()[0] != "")
				{
					// User has already entered a unit, so skip to the next part
					return BM.Tour.nextTourStep();
				}

				BM.RightSidebar.setVisible(true);

				unitFilter.filterControl.focus();
				callback(incidentTypeFilter.selectorControlContainer);
			},
			waitForTargetFn: function(callback) {
				var incidentTypeFilter = BM.FilterPanel.contactFilterController.getFilterById(BM.FilterID.contact.type);
				if (!incidentTypeFilter.isChecked())
					callback(incidentTypeFilter.selectorControl);
				else
					callback();
			},
			waitForInteraction: 'ifToggled'
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'The \'Incident Type\' Filter',
			position: 'right',
			body: '<p>This filter restricts incidents based on their type. Currently, you can choose from contacts or mine incidents.</p>' +
				'<p class="tour-action-step">Choose the <strong>Mine</strong> incident type from the list</p>',
			tooltipTargetFn: function (callback) {
				var incidentTypeFilter = BM.FilterPanel.contactFilterController.getFilterById(BM.FilterID.contact.type);
				if (incidentTypeFilter.getValues()[0] === 1)
				{
					// Mine incident type is already checked and selected
					return BM.Tour.nextTourStep();
				}

				BM.RightSidebar.setVisible(true);

				callback(incidentTypeFilter.filterControlContainer);
			},
			waitForTargetFn: function(callback) {
				var incidentTypeFilter = BM.FilterPanel.contactFilterController.getFilterById(BM.FilterID.contact.type);
				if (incidentTypeFilter.isChecked())
					callback(incidentTypeFilter.filterControl);
				else
					callback();
			},
			waitForInteraction: 'selectmenuselect'
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'Applying the Filter',
			position: 'right',
			body: '<p>We have now entered two filters. You can try other combinations later - for now, we will apply our new filter to the map.</p>' +
				'<p class="tour-action-step">Click the <strong>Apply Filter</strong> button</p>',
			tooltipTargetFn: function (callback) {
				BM.RightSidebar.setVisible(true);
				callback($('#buttonApplyFilter'));
			},
			waitForTargetFn: function(callback) {
				callback($('#buttonApplyFilter'));
			}
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'Clearing the Filters',
			position: 'right',
			body: '<p>For the next section, we will want to work with all contacts. Therefore, we will <strong>clear the filters</strong>. This will restore all filters to their original ' +
			'values, deselect them and bring the map back to its original, unfiltered view.</p>' +
			'<p class="tour-action-step">Clear the filters by clicking the <strong>Clear</strong> button</p>',
			tooltipTargetFn: function (callback) {
				BM.RightSidebar.setVisible(true);

				callback($('#buttonClearFilter'));
			},
			waitForTargetFn: function(callback) {
				callback($('#buttonClearFilter'));
			}
		}));

		_tourSteps.push(new BM.TourStep({
			title: 'Charts',
			position: 'right',
			body: '<p><strong>Charts</strong> allow you to observe <strong>trends</strong> in contact data over time. Some charts have different variants, such as those showing information in a date series and others ' +
			'by time of day</p>' +
			'<p class="tour-action-step">You can open a chart by clicking on an item in this section. <strong>Go ahead and try that now.</strong></p>' +
			'<p>Now a chart is displayed, try:</p>' +
			'<ol><li>Viewing information specific to the current chart by hovering over the <strong>?</strong> icon at the top-right</li>' +
				'<li>Interacting with the chart, such as dragging over it (line charts) to select a date range</li>' +
				'<li>Combining the chart with filters. Note only some filters are supported; click the <strong>?</strong> icon in each chart window for details.</li></ol>',
			buttonText: '<strong>Next:</strong> Using the Timeline',
			buttonAlign: 'right',
			tooltipTargetFn: function (callback) {
				BM.RightSidebar.setVisible(true);
				callback($('#map-chart-control-container'));
			},
			stepCompletionFn: function(callback) {
				var selectedChartGroup = BM.AnalyticsPanel.chartController.getSelectedGroup();
				if (selectedChartGroup)
					selectedChartGroup.uncheck(false, callback);
				else
					callback();
			}
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'Using the Timeline',
			position: 'top',
			body: '<p>The <strong>Timeline</strong> allows you to select contacts within a date range. The <strong>chart</strong> within it indicates the frequency of contacts vs time.</p>' +
			'<p>The <strong>handles</strong> left and right of the chart can be dragged to filter the contacts in real time.</p>' +
			'<p class="tour-action-step"><strong>Click and drag</strong> the indicated <strong>left-most handle</strong> to the right, taking note of the change in <strong>incident markers</strong></p>',
			tooltipTargetFn: function (callback) {
				callback($('#timeline-chart').find('g.highcharts-navigator-handle-left'));
			},
			waitForTargetFn: function(callback) {
				callback($('#timeline-chart').find('g.highcharts-navigator-handle-left'));
			},
			waitForInteraction: 'mousedown'
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'Accessing the Advanced Timeline',
			position: 'top-left',
			body: '<p>You can select a <strong>precise date range</strong> and access more advanced Timeline controls by <strong>expanding</strong> the Timeline.</p>' +
			'<p class="tour-action-step"><strong>Click</strong> the up-arrow to access the <strong>Advanced Timeline</strong></p>',
			tooltipTargetFn: function (callback) {
				if (BM.Timeline.isExpanded())
					return BM.Tour.nextTourStep();

				callback($('#timeline-expand-button'));
			},
			waitForTargetFn: function(callback) {
				callback($('#timeline-expand-button'));
			}
		}));

		_tourSteps.push(new BM.TourStep({
			title: 'Using the Advanced Timeline',
			position: 'top',
			body: '<p>A larger chart is now shown, displaying the same information as the basic Timeline, but at a different scale.</p>' +
			'<p class="tour-action-step">Try the following, noting how the map markers change as you go:</p>' +
			'<ol><li>Choose a specific <strong>date range</strong> using the two date boxes</li>' +
			'<li><strong>Drag-select</strong> inside the larger chart, to <strong>restrict</strong> the date range</li>' +
			'<li>Select a <strong>predefined date interval</strong> using the <em>1 month</em>, <em>6 months</em>, <em>...</em> buttons</li></ol>',
			buttonText: '<strong>Next:</strong> Play through contacts',
			buttonAlign: 'right',
			tooltipTargetFn: function (callback) {
				callback($('#map-timeline'));
			},
			stepCompletionFn: function(callback) {
				BM.Timeline.collapseTimeline(function() {
					if (callback)
						callback();
				});
			}
		}));

		_tourSteps.push(new BM.TourStep_WaitForInteraction({
			title: 'Playing through Contacts using the Timeline',
			position: 'top-left',
			offsetY: 10,
			body: '<p>The Timeline can <em><strong>play through</strong></em> contacts, enabling you to observe the geographic trend of incidents during the course of the Vietnam War.</p>' +
				'<p>This feature works best when the Timeline is minimised.</p>' +
				'<p class="tour-action-step"><strong>Step 1.</strong> Using the <strong>handles</strong> as previously shown, choose a small time slice at the beginning of the Timeline</p>' +
				'<p class="tour-action-step"><strong>Step 2.</strong> <strong>Click</strong> the indicated <strong>Play</strong> button and watch the map</p>',
			tooltipTargetFn: function (callback) {
				var individualContacts = layerController.getLayer(BM.LayerType.contact.individual);
				if (!individualContacts.isChecked())
				{
					individualContacts.check(function() {
						callback($('#timeline-play-button'));
					});
				}
				else
				{
					callback($('#timeline-play-button'));
				}
			},
			waitForTargetFn: function(callback) {
				callback($('#timeline-play-button'));
			}
		}));

		_tourSteps.push(new BM.TourStep({
			title: 'That\'s It!',
			position: 'left',
			body: '<p>That\'s the end of the tour!</p>' +
				'<p>We hope you enjoy using this website. We recognise it currently focuses on 1 ATF combat actions, however ' +
					'<strong><a href="/phase-two" target="_blank">many new features</a></strong> are coming, including coverage of air and sea operations and the ability to upload photos and videos.</p>' +
				'<p>In the meantime, why not read what veterans are writing about combat incidents? You can do this by selecting any of the incident notes from the list.</p>' +
				'<p class="tour-action-step">If you like our site or have suggestions, please leave <strong>feedback</strong> using the button at the bottom-right</p>',
			buttonText: '<strong>Keep exploring the Battle Map</strong>',
			buttonAlign: 'left',
			tooltipTargetFn: function (callback) {
				if (!IncidentNotesPanel.isShowing())
				{
					IncidentNotesPanel.show(function () {
						callback($('#map-incident-notes-panel'));
					});
				}
				else
				{
					callback($('#map-incident-notes-panel'));
				}
			},
			stepCompletionFn: function(callback) {
				BM.Timeline.pause();
			}
		}));
	}

	return {
		nextTourStep: _nextTourStep,
		startTour: _startTour,
		endTour: _endTour,

		init: function()
		{
			$('#map-tour-button')
				.tooltipster({
					content: $('<span>' + _tourButtonDefaultTitle + '</span>'),
					position: 'bottom',
					updateAnimation: false,
					animation: 'grow',
					timer: 6000
				})
				.click(function() {
					if (_tourInProgress)
						_endTour();
					else
						_startTour();
				});

			// Instantiate the tour steps
			_populateTourSteps();
		}
	};
})();